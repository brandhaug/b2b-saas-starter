import { Database } from '@b2b-saas-starter/db/service'
import { user, workspaceMembers, workspaces } from '@b2b-saas-starter/db/schema'
import { Context, Effect, Layer, Ref, Schema } from 'effect'
import { and, asc, eq, gt, type SQL } from 'drizzle-orm'
import { type CapabilityUnavailable, MembershipChangeRejected } from '../errors.ts'
import {
  clampPageLimit,
  cutKeysetPage,
  decodeKeysetCursor,
  seedKeysetPage,
  type ListPageInput,
  type Page
} from '../internal/keyset-cursor.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { publishSeatSyncWith, SeatSyncPublisher } from '../billing/seat-sync.ts'
import { AuditEventLog, recordInWorkspace } from './audit-event-log.ts'
import { makeBindingCaller } from './plugin-binding-failure.ts'
import {
  fabricateSeedMember,
  findWorkspaceMember,
  Member,
  requireMemberRowId,
  toMember,
  toWorkspace,
  Workspace,
  type WorkspaceRole
} from './workspace-identity.ts'

export const WorkspaceWithMembership = Schema.Struct({
  workspace: Workspace,
  member: Member
})
export type WorkspaceWithMembership = typeof WorkspaceWithMembership.Type

export type WorkspaceMembershipInterface = {
  readonly listMembers: Effect.Effect<
    ReadonlyArray<Member>,
    CapabilityUnavailable,
    WorkspaceContext
  >

  /**
   * The paged read the REST and MCP list surfaces serve (ADR 0054). The
   * member wire shape carries no timestamp, so pages run forward on
   * `id ASC` (user id) — the stable order a caller can resume. `listMembers`
   * stays for the app's whole-roster reads.
   */
  readonly listMembersPage: (
    input?: ListPageInput
  ) => Effect.Effect<Page<Member>, CapabilityUnavailable, WorkspaceContext>

  /**
   * Every workspace the user is a member of, with their membership row.
   * Cross-workspace read keyed by user id (no `WorkspaceContext`) — this is
   * the "my workspaces" model, resolved before any single workspace is
   * selected. Possibly empty; never discloses workspaces the user is not in.
   */
  readonly listWorkspacesForUser: (
    userId: string
  ) => Effect.Effect<ReadonlyArray<WorkspaceWithMembership>, CapabilityUnavailable>
  readonly addMember: (
    input: MemberRoleInput
  ) => Effect.Effect<
    Member,
    CapabilityUnavailable | MembershipChangeRejected,
    WorkspaceContext
  >

  readonly removeMember: (
    input: MemberRef
  ) => Effect.Effect<
    void,
    CapabilityUnavailable | MembershipChangeRejected,
    WorkspaceContext
  >

  readonly changeRole: (
    input: MemberRoleInput
  ) => Effect.Effect<
    Member,
    CapabilityUnavailable | MembershipChangeRejected,
    WorkspaceContext
  >
}

export type MemberRef = {
  readonly userId: string
}

export type MemberRoleInput = MemberRef & {
  readonly role: WorkspaceRole
}

export class WorkspaceMembership extends Context.Service<
  WorkspaceMembership,
  WorkspaceMembershipInterface
>()('@b2b-saas-starter/capabilities/WorkspaceMembership') {}

/**
 * The fixture's member roster. Held as a `Ref` and passed in rather than built
 * inside `SeedWorkspaceMembership`, because accepting an invitation adds a
 * member: `SeedWorkspaceInvitations` writes to the same roster this capability
 * reads, and two independent `Ref`s would let the seed adapters disagree about
 * who is a member. Live has no such seam — the plugin owns both writes.
 */
export type SeedRoster = Ref.Ref<ReadonlyArray<Member>>

export function makeSeedRoster(
  members: ReadonlyArray<Member>
): Effect.Effect<SeedRoster> {
  return Ref.make<ReadonlyArray<Member>>(members)
}

/**
 * Fails the way the Live adapter fails for a user with no membership, so the
 * shared contract in `workspace-membership.contract.ts` holds on both sides.
 */
function requireMember(
  roster: SeedRoster,
  userId: string
): Effect.Effect<Member, MembershipChangeRejected> {
  return Ref.get(roster).pipe(
    Effect.flatMap((current) => {
      const member = current.find((candidate) => candidate.id === userId)
      if (!member) {
        return Effect.fail(new MembershipChangeRejected({ reason: 'not_a_member' }))
      }
      return Effect.succeed(member)
    })
  )
}

/**
 * In-memory membership, never Better Auth. The roster is built per layer
 * construction (see `makeSeedRoster`), so a mutation is observable within the
 * request or test that made it and no state leaks into the next one.
 *
 * Requires the `SeatSyncPublisher` so membership mutations trigger the same
 * seat sync the Live adapter triggers — best-effort, after the write, exactly
 * like the webhook fan-out below the developer-platform capabilities.
 */
export function SeedWorkspaceMembership(
  roster: SeedRoster,
  workspace: Workspace
): Layer.Layer<WorkspaceMembership, never, SeatSyncPublisher> {
  return Layer.effect(WorkspaceMembership)(
    Effect.gen(function* () {
      const seatSync = yield* SeatSyncPublisher

      return {
        listMembers: Ref.get(roster),
        listMembersPage: (input) =>
          Effect.map(
            Ref.get(roster),
            // Forward on `id ASC` (user id) — the member wire shape carries no
            // timestamp, so the id is the one stable order a page can resume.
            (members) =>
              seedKeysetPage(
                members,
                'asc',
                (member) => ({ key: member.id, id: member.id }),
                input
              )
          ),
        listWorkspacesForUser: (userId) =>
          Ref.get(roster).pipe(
            Effect.map((current) => {
              const member = current.find((candidate) => candidate.id === userId)
              if (!member) {
                return []
              }
              return [{ workspace, member }]
            })
          ),
        addMember: (input) =>
          Effect.gen(function* () {
            // No `user` table to join, so the fixture fabricates the identity
            // fields the way `SeedApiTokenRegistry.create` fabricates a token.
            const added = fabricateSeedMember(input.userId, input.role)
            yield* Ref.update(roster, (current) => [...current, added])
            yield* publishSeatSyncWith(seatSync, {
              workspaceId: workspace.id,
              reason: 'member_added'
            })
            return added
          }),
        removeMember: (input) =>
          Effect.gen(function* () {
            yield* requireMember(roster, input.userId)
            yield* Ref.update(roster, (current) =>
              current.filter((candidate) => candidate.id !== input.userId)
            )
            yield* publishSeatSyncWith(seatSync, {
              workspaceId: workspace.id,
              reason: 'member_removed'
            })
          }),
        changeRole: (input) =>
          Effect.gen(function* () {
            const member = yield* requireMember(roster, input.userId)
            const promoted: Member = { ...member, role: input.role }
            yield* Ref.update(roster, (current) =>
              current.map((candidate) => {
                if (candidate.id === input.userId) {
                  return promoted
                }
                return candidate
              })
            )
            return promoted
          })
      }
    })
  )
}

/**
 * The write half of membership, as this package needs it — a structural port,
 * not the plugin's wire shape. Better Auth's `organization` plugin sits behind
 * it, but `capabilities` never names the plugin: the same reason
 * `WebhookQueueBinding` describes a queue instead of importing
 * `@cloudflare/workers-types`, and the reason `auth` and `capabilities` stay
 * siblings (see `../../authz/AGENTS.md`).
 *
 * The app supplies the adapter, because two of the three plugin endpoints are
 * `requireHeaders: true` and only the app holds the request's session headers.
 * `addMember` alone runs headerless.
 *
 * Promise-returning on purpose: an Effect-shaped port would have to name the
 * plugin's error type, which is exactly the leak this avoids. Rejections are
 * classified by `makeBindingCaller`'s `callBinding`.
 *
 * Resolving to `void`, not to the plugin's response: the capability re-reads the
 * member from D1 after every call, because the plugin's own response shape is
 * not this package's contract. Handing the raw response back would leak it.
 */
export type WorkspaceMemberBinding = {
  readonly addMember: (input: {
    readonly workspaceId: string
    readonly userId: string
    readonly role: WorkspaceRole
  }) => Promise<void>
  readonly removeMember: (input: {
    readonly workspaceId: string
    readonly memberId: string
  }) => Promise<void>
  readonly changeRole: (input: {
    readonly workspaceId: string
    readonly memberId: string
    readonly role: WorkspaceRole
  }) => Promise<void>
}

const { callBinding } = makeBindingCaller<
  WorkspaceMemberBinding,
  MembershipChangeRejected
>({
  capability: 'workspace-membership',
  noBindingReason: 'no_member_binding',
  Rejected: MembershipChangeRejected
})

export function LiveWorkspaceMembership(
  binding?: WorkspaceMemberBinding
): Layer.Layer<
  WorkspaceMembership,
  never,
  Database | AuditEventLog | SeatSyncPublisher
> {
  return Layer.effect(WorkspaceMembership)(
    Effect.gen(function* () {
      const db = yield* Database
      const audit = yield* AuditEventLog
      const seatSync = yield* SeatSyncPublisher

      const unavailable = orUnavailable('workspace-membership')

      /**
       * The plugin addresses a member by its surrogate row id, while every
       * capability caller speaks in user ids. Resolving here also supplies the
       * `not_a_member` rejection without a second round trip.
       */
      function resolveMemberId(workspaceId: string, userId: string) {
        return requireMemberRowId(
          db,
          { workspaceId, userId },
          () => new MembershipChangeRejected({ reason: 'not_a_member' })
        )
      }

      /** Reads the member back through the same join `listMembers` uses. */
      const readMember = Effect.fnUntraced(function* (
        workspaceId: string,
        userId: string
      ) {
        const member = yield* findWorkspaceMember(db, { workspaceId, userId })
        if (!member) {
          return yield* Effect.fail(
            new MembershipChangeRejected({ reason: 'not_a_member' })
          )
        }
        return member
      })

      return {
        listMembers: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const rows = yield* unavailable(
            db
              .select({ member: workspaceMembers, user })
              .from(workspaceMembers)
              .innerJoin(user, eq(user.id, workspaceMembers.userId))
              .where(eq(workspaceMembers.workspaceId, ctx.workspace.id))
          )
          return rows.map(toMember)
        }),
        listMembersPage: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const conditions: Array<SQL> = [
              eq(workspaceMembers.workspaceId, ctx.workspace.id)
            ]
            // Forward on user `id ASC` — no timestamp on the wire shape, so a
            // cursor is every member with a strictly greater id.
            if (input?.cursor !== undefined) {
              const cursor = decodeKeysetCursor(input.cursor)
              if (cursor === null) {
                return { items: [], nextCursor: null }
              }
              conditions.push(gt(workspaceMembers.userId, cursor.id))
            }
            const rows = yield* unavailable(
              db
                .select({ member: workspaceMembers, user })
                .from(workspaceMembers)
                .innerJoin(user, eq(user.id, workspaceMembers.userId))
                .where(and(...conditions))
                .orderBy(asc(workspaceMembers.userId))
                .limit(clampPageLimit(input?.limit) + 1)
            )
            return cutKeysetPage(
              rows.map(toMember),
              clampPageLimit(input?.limit),
              (member) => ({ key: member.id, id: member.id })
            )
          }),
        listWorkspacesForUser: (userId) =>
          unavailable(
            db
              .select({ workspace: workspaces, member: workspaceMembers, user })
              .from(workspaceMembers)
              .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
              .innerJoin(user, eq(user.id, workspaceMembers.userId))
              .where(eq(workspaceMembers.userId, userId))
          ).pipe(
            Effect.map((rows) =>
              rows.map((row) => ({
                workspace: toWorkspace(row.workspace),
                member: toMember(row)
              }))
            )
          ),
        addMember: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            yield* callBinding(binding, (bound) =>
              bound.addMember({
                workspaceId: ctx.workspace.id,
                userId: input.userId,
                role: input.role
              })
            )
            const member = yield* readMember(ctx.workspace.id, input.userId)
            yield* recordInWorkspace(audit, {
              eventType: 'workspace_member.added',
              targetType: 'workspace_member',
              targetId: input.userId,
              metadata: { role: input.role }
            })
            // Seat sync rides a queue the background worker consumes, so this
            // mutation never awaits Stripe — best-effort, after the audit.
            yield* publishSeatSyncWith(seatSync, {
              workspaceId: ctx.workspace.id,
              reason: 'member_added'
            })
            return member
          }),
        removeMember: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const memberId = yield* resolveMemberId(ctx.workspace.id, input.userId)
            yield* callBinding(binding, (bound) =>
              bound.removeMember({ workspaceId: ctx.workspace.id, memberId })
            )
            yield* recordInWorkspace(audit, {
              eventType: 'workspace_member.removed',
              targetType: 'workspace_member',
              targetId: input.userId
            })
            yield* publishSeatSyncWith(seatSync, {
              workspaceId: ctx.workspace.id,
              reason: 'member_removed'
            })
          }),
        changeRole: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const memberId = yield* resolveMemberId(ctx.workspace.id, input.userId)
            yield* callBinding(binding, (bound) =>
              bound.changeRole({
                workspaceId: ctx.workspace.id,
                memberId,
                role: input.role
              })
            )
            const member = yield* readMember(ctx.workspace.id, input.userId)
            yield* recordInWorkspace(audit, {
              eventType: 'workspace_member.role_changed',
              targetType: 'workspace_member',
              targetId: input.userId,
              metadata: { role: input.role }
            })
            return member
          })
      }
    })
  )
}
