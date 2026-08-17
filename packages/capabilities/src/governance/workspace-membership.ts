import { Context, Effect, Layer, Ref, Schema } from 'effect'
import { and, eq } from 'drizzle-orm'
import { Database, user, workspaceMembers, workspaces } from '@b2b-saas-starter/db'
import { CapabilityUnavailable, MembershipChangeRejected } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { AuditEventLog } from './audit-event-log.ts'
import {
  findWorkspaceMember,
  Member,
  toMember,
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
    readonly Member[],
    CapabilityUnavailable,
    WorkspaceContext
  >
  /**
   * Every workspace the user is a member of, with their membership row.
   * Cross-workspace read keyed by user id (no `WorkspaceContext`) — this is
   * the "my workspaces" model, resolved before any single workspace is
   * selected. Possibly empty; never discloses workspaces the user is not in.
   */
  readonly listWorkspacesForUser: (
    userId: string
  ) => Effect.Effect<readonly WorkspaceWithMembership[], CapabilityUnavailable>
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
export type SeedRoster = Ref.Ref<readonly Member[]>

export function makeSeedRoster(members: readonly Member[]): Effect.Effect<SeedRoster> {
  return Ref.make<readonly Member[]>(members)
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
 */
export function SeedWorkspaceMembership(
  roster: SeedRoster,
  workspace: Workspace
): Layer.Layer<WorkspaceMembership> {
  // `Layer.succeed`, not `Layer.effect`: the roster is built by the caller now
  // (so invitations can share it), leaving nothing effectful to do here.
  return Layer.succeed(WorkspaceMembership)({
    listMembers: Ref.get(roster),
    listWorkspacesForUser: (userId) =>
      Ref.get(roster).pipe(
        Effect.map((current) => {
          const member = current.find((candidate) => candidate.id === userId)
          if (!member) return []
          return [{ workspace, member }]
        })
      ),
    addMember: (input) =>
      Effect.gen(function* () {
        // No `user` table to join, so the fixture fabricates the identity
        // fields the way `SeedApiTokenRegistry.create` fabricates a token.
        const added: Member = {
          id: input.userId,
          name: input.userId,
          email: `${input.userId}@seed.local`,
          role: input.role,
          systemRole: 'user'
        }
        yield* Ref.update(roster, (current) => [...current, added])
        return added
      }),
    removeMember: (input) =>
      Effect.gen(function* () {
        yield* requireMember(roster, input.userId)
        yield* Ref.update(roster, (current) =>
          current.filter((candidate) => candidate.id !== input.userId)
        )
      }),
    changeRole: (input) =>
      Effect.gen(function* () {
        const member = yield* requireMember(roster, input.userId)
        const promoted: Member = { ...member, role: input.role }
        yield* Ref.update(roster, (current) =>
          current.map((candidate) => {
            if (candidate.id === input.userId) return promoted
            return candidate
          })
        )
        return promoted
      })
  })
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
 * classified by `classifyBindingFailure` below.
 */
export type WorkspaceMemberBinding = {
  readonly addMember: (input: {
    readonly workspaceId: string
    readonly userId: string
    readonly role: WorkspaceRole
  }) => Promise<unknown>
  readonly removeMember: (input: {
    readonly workspaceId: string
    readonly memberId: string
  }) => Promise<unknown>
  readonly changeRole: (input: {
    readonly workspaceId: string
    readonly memberId: string
    readonly role: WorkspaceRole
  }) => Promise<unknown>
}

const noBinding = new CapabilityUnavailable({
  capability: 'workspace-membership',
  reason: 'no_member_binding'
})

/**
 * A 4xx from the plugin means the workspace refused the change — an unknown
 * user, a role it will not accept. Anything else (5xx, a thrown TypeError, a
 * dropped connection) is the store failing, which is what
 * `CapabilityUnavailable` means. Getting this backwards tells a caller to
 * retry a request that can never succeed.
 */
function classifyBindingFailure(
  cause: unknown
): CapabilityUnavailable | MembershipChangeRejected {
  const status = statusCodeOf(cause)
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return new MembershipChangeRejected({ reason: messageOf(cause) })
  }
  return new CapabilityUnavailable({
    capability: 'workspace-membership',
    reason: messageOf(cause)
  })
}

/** Better Auth's `APIError` carries a numeric `statusCode`; a network blow-up does not. */
function statusCodeOf(cause: unknown): unknown {
  if (typeof cause !== 'object' || cause === null) return undefined
  if (!('statusCode' in cause)) return undefined
  return cause.statusCode
}

function messageOf(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  return String(cause)
}

export function LiveWorkspaceMembership(
  binding?: WorkspaceMemberBinding
): Layer.Layer<WorkspaceMembership, never, Database | AuditEventLog> {
  return Layer.effect(WorkspaceMembership)(
    Effect.gen(function* () {
      const db = yield* Database
      const audit = yield* AuditEventLog

      const unavailable = orUnavailable('workspace-membership')

      /**
       * The plugin addresses a member by its surrogate row id, while every
       * capability caller speaks in user ids. Resolving here also supplies the
       * `not_a_member` rejection without a second round trip.
       */
      const resolveMemberId = Effect.fnUntraced(function* (
        workspaceId: string,
        userId: string
      ) {
        const rows = yield* unavailable(
          db
            .select({ id: workspaceMembers.id })
            .from(workspaceMembers)
            .where(
              and(
                eq(workspaceMembers.workspaceId, workspaceId),
                eq(workspaceMembers.userId, userId)
              )
            )
            .limit(1)
        )
        const row = rows[0]
        if (!row) {
          return yield* Effect.fail(
            new MembershipChangeRejected({ reason: 'not_a_member' })
          )
        }
        return row.id
      })

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

      const callBinding = Effect.fnUntraced(function* <A>(
        call: (bound: WorkspaceMemberBinding) => Promise<A>
      ) {
        if (!binding) return yield* Effect.fail(noBinding)
        return yield* Effect.tryPromise({
          try: () => call(binding),
          catch: classifyBindingFailure
        })
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
                workspace: {
                  id: row.workspace.id,
                  slug: row.workspace.slug,
                  name: row.workspace.name,
                  planId: row.workspace.planId
                },
                member: toMember(row)
              }))
            )
          ),
        addMember: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            yield* callBinding((bound) =>
              bound.addMember({
                workspaceId: ctx.workspace.id,
                userId: input.userId,
                role: input.role
              })
            )
            const member = yield* readMember(ctx.workspace.id, input.userId)
            // Not atomic with the write above, and it cannot be: D1 rejects an
            // explicit BEGIN, and a plugin write cannot join a `batch()`. The
            // audit row may therefore be missing after a crash between the two.
            // Accepted and recorded on the map, not an oversight.
            yield* audit.record({
              workspaceId: ctx.workspace.id,
              actorUserId: ctx.actor?.userId ?? null,
              eventType: 'workspace_member.added',
              targetType: 'workspace_member',
              targetId: input.userId,
              metadata: { role: input.role }
            })
            return member
          }),
        removeMember: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const memberId = yield* resolveMemberId(ctx.workspace.id, input.userId)
            yield* callBinding((bound) =>
              bound.removeMember({ workspaceId: ctx.workspace.id, memberId })
            )
            yield* audit.record({
              workspaceId: ctx.workspace.id,
              actorUserId: ctx.actor?.userId ?? null,
              eventType: 'workspace_member.removed',
              targetType: 'workspace_member',
              targetId: input.userId
            })
          }),
        changeRole: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const memberId = yield* resolveMemberId(ctx.workspace.id, input.userId)
            yield* callBinding((bound) =>
              bound.changeRole({
                workspaceId: ctx.workspace.id,
                memberId,
                role: input.role
              })
            )
            const member = yield* readMember(ctx.workspace.id, input.userId)
            yield* audit.record({
              workspaceId: ctx.workspace.id,
              actorUserId: ctx.actor?.userId ?? null,
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
