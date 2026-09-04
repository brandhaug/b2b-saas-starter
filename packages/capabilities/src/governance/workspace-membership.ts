import { Context, Effect, Layer, Option, Ref, Schema } from 'effect'
import { type CapabilityUnavailable, MembershipChangeRejected } from '../errors.ts'
import {
  seedKeysetPage,
  type ListPageInput,
  type Page
} from '../internal/keyset-cursor.ts'
import { type WorkspaceContext } from '../workspace-context.ts'
import { publishSeatSyncWith, SeatSyncPublisher } from '../billing/seat-sync.ts'
import { AuditEventLog, recordInWorkspace } from './audit-event-log.ts'
import {
  fabricateSeedMember,
  Member,
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
   * The paged read the REST and MCP list surfaces serve (ADR 0057). The
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
 * Membership mutations record the same `workspace_member.*` audit events the
 * Live adapter records, read ambiently via `Effect.serviceOption`: the Seed
 * composition (`layers.ts`) shares one fixture log so records land where the
 * contract cases read them, while a harness that provides no log simply gets
 * no records — the same provider-light posture an absent `SeatSyncPublisher`
 * binding takes.
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
            // Same event, same target, same metadata as the Live adapter.
            const audit = yield* Effect.serviceOption(AuditEventLog)
            if (Option.isSome(audit)) {
              yield* recordInWorkspace(audit.value, {
                eventType: 'workspace_member.added',
                targetType: 'workspace_member',
                targetId: input.userId,
                metadata: { role: input.role }
              })
            }
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
            const audit = yield* Effect.serviceOption(AuditEventLog)
            if (Option.isSome(audit)) {
              yield* recordInWorkspace(audit.value, {
                eventType: 'workspace_member.removed',
                targetType: 'workspace_member',
                targetId: input.userId
              })
            }
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
            const audit = yield* Effect.serviceOption(AuditEventLog)
            if (Option.isSome(audit)) {
              yield* recordInWorkspace(audit.value, {
                eventType: 'workspace_member.role_changed',
                targetType: 'workspace_member',
                targetId: input.userId,
                metadata: { role: input.role }
              })
            }
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
