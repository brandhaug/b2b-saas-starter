import { Context, Effect, Layer, Option, Ref, Schema } from 'effect'
import { type CapabilityUnavailable, MembershipChangeRejected } from '../errors.ts'
import {
  seedKeysetPage,
  type ListPageInput,
  type Page
} from '../internal/keyset-cursor.ts'
import { WorkspaceContext } from '../workspace-context.ts'
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

  /**
   * The actor's own membership, ended by their own hand. Any member may ask —
   * the `WorkspaceContext` already proved the membership, and the plugin's
   * leave endpoint demands no permission statement — with the one refusal
   * both the rule below and the plugin share: a sole owner transfers
   * ownership first. The inverse of `removeMember`, which is someone else's
   * decision about the actor's workspace.
   */
  readonly leave: Effect.Effect<
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

/**
 * The closed reason vocabulary both adapters refuse with before the plugin is
 * asked. The plugin's own refusals are 4xx replies whose message text is all
 * a caller could match on — these machine reasons are what the boundary maps
 * copy from. Widen the record, never inline a string (the same rule
 * `AUTHORIZATION_DENIED_REASONS` follows in `authz`).
 */
// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
export const MEMBERSHIP_REFUSAL_REASONS = {
  /** The acted-on user holds no membership in this workspace. */
  notAMember: 'not_a_member',
  /** Last-owner protection: removing, demoting, or leaving would strand the workspace without an owner. */
  soleOwner: 'sole_owner',
  /** Granting or changing an owner's role is reserved to owners — the plugin's `creatorRole` rule. */
  ownerRequiresOwner: 'owner_requires_owner'
} as const
export type MembershipRefusalReason =
  (typeof MEMBERSHIP_REFUSAL_REASONS)[keyof typeof MEMBERSHIP_REFUSAL_REASONS]

export type MembershipChangeIntent = 'remove' | 'change_role' | 'leave'

/**
 * The ownership rules the organization plugin enforces on its member
 * endpoints, written once so both adapters refuse identically and with a
 * machine reason. The rule is what the store enforces, stated in the
 * capability — the same shape as `planAccountDeletion`, for the same reason:
 * deriving it here keeps the Seed adapter (which has no plugin) honest and
 * spares callers message-text matching. It is not authorization: who may ask
 * at all is `requirePermission` at the route boundary; this is the
 * workspace's own invariant about who its owners may be.
 *
 * `null` means the change may proceed to the binding.
 */
export function refuseMembershipChange(
  intent: MembershipChangeIntent,
  input: {
    /** The acting member's role; `null` when the context carries no actor. */
    readonly actorRole: WorkspaceRole | null
    /** The acted-on member's role; `null` names a non-member. For a leave this is the actor's own. */
    readonly targetRole: WorkspaceRole | null
    /** How many owners the roster holds, target included. */
    readonly ownerCount: number
    /** The role a `change_role` would set; ignored by the other intents. */
    readonly nextRole?: WorkspaceRole
  }
): MembershipRefusalReason | null {
  const { actorRole, targetRole, ownerCount } = input
  if (intent === 'leave') {
    // The leave is the actor's own verb: no actor is no membership to leave,
    // and a sole owner transfers ownership first.
    if (actorRole === null) {
      return MEMBERSHIP_REFUSAL_REASONS.notAMember
    }
    if (actorRole === 'owner' && ownerCount <= 1) {
      return MEMBERSHIP_REFUSAL_REASONS.soleOwner
    }
    return null
  }
  if (targetRole === null) {
    return MEMBERSHIP_REFUSAL_REASONS.notAMember
  }
  if (intent === 'remove') {
    if (targetRole === 'owner' && ownerCount <= 1) {
      return MEMBERSHIP_REFUSAL_REASONS.soleOwner
    }
    if (targetRole === 'owner' && actorRole !== 'owner') {
      return MEMBERSHIP_REFUSAL_REASONS.ownerRequiresOwner
    }
    return null
  }
  // `change_role`: any change that touches the owner role — granting it, or
  // rewriting someone who holds it — is reserved to owners, and the last
  // owner cannot be demoted out from under the workspace.
  const touchesOwnerRole = targetRole === 'owner' || input.nextRole === 'owner'
  if (touchesOwnerRole && actorRole !== 'owner') {
    return MEMBERSHIP_REFUSAL_REASONS.ownerRequiresOwner
  }
  if (targetRole === 'owner' && ownerCount <= 1 && input.nextRole !== 'owner') {
    return MEMBERSHIP_REFUSAL_REASONS.soleOwner
  }
  return null
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

/** Owners on a roster — the count the ownership rule reads. */
function ownerCountOf(members: ReadonlyArray<Member>): number {
  return members.filter((member) => member.role === 'owner').length
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
            // The ownership rule runs against the roster this adapter owns,
            // refusing with a machine reason where the plugin would refuse
            // with message text (and where the plugin never gets a say, since
            // the binding here is a stand-in).
            const ctx = yield* WorkspaceContext
            const current = yield* Ref.get(roster)
            const target = current.find((candidate) => candidate.id === input.userId)
            const refusal = refuseMembershipChange('remove', {
              actorRole: ctx.actor?.role ?? null,
              targetRole: target?.role ?? null,
              ownerCount: ownerCountOf(current)
            })
            if (refusal !== null) {
              return yield* Effect.fail(
                new MembershipChangeRejected({ reason: refusal })
              )
            }
            yield* Ref.update(roster, (rows) =>
              rows.filter((candidate) => candidate.id !== input.userId)
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
        leave: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const current = yield* Ref.get(roster)
          // The actor's own row — no actor, or an actor the roster no longer
          // carries (a concurrent removal), is no membership to leave, and
          // failing closed here is what lets the rule below speak in
          // non-null roles.
          const own = current.find((member) => member.id === ctx.actor?.userId)
          if (own === undefined) {
            return yield* Effect.fail(
              new MembershipChangeRejected({
                reason: MEMBERSHIP_REFUSAL_REASONS.notAMember
              })
            )
          }
          const refusal = refuseMembershipChange('leave', {
            actorRole: own.role,
            targetRole: own.role,
            ownerCount: ownerCountOf(current)
          })
          if (refusal !== null) {
            return yield* Effect.fail(new MembershipChangeRejected({ reason: refusal }))
          }
          yield* Ref.update(roster, (rows) =>
            rows.filter((member) => member.id !== own.id)
          )
          const audit = yield* Effect.serviceOption(AuditEventLog)
          if (Option.isSome(audit)) {
            yield* recordInWorkspace(audit.value, {
              eventType: 'workspace_member.removed',
              targetType: 'workspace_member',
              targetId: own.id,
              metadata: { reason: 'left' }
            })
          }
          yield* publishSeatSyncWith(seatSync, {
            workspaceId: workspace.id,
            reason: 'member_removed'
          })
        }),
        changeRole: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            // One roster read serves both halves: the target row to rewrite
            // and the owner count the rule refuses on.
            const current = yield* Ref.get(roster)
            const member = current.find((candidate) => candidate.id === input.userId)
            if (member === undefined) {
              return yield* Effect.fail(
                new MembershipChangeRejected({
                  reason: MEMBERSHIP_REFUSAL_REASONS.notAMember
                })
              )
            }
            const refusal = refuseMembershipChange('change_role', {
              actorRole: ctx.actor?.role ?? null,
              targetRole: member.role,
              ownerCount: ownerCountOf(current),
              nextRole: input.role
            })
            if (refusal !== null) {
              return yield* Effect.fail(
                new MembershipChangeRejected({ reason: refusal })
              )
            }
            const promoted: Member = { ...member, role: input.role }
            yield* Ref.update(roster, (rows) =>
              rows.map((candidate) => {
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
 * The app supplies the adapter, because three of the four plugin endpoints are
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
  /** The plugin's leave endpoint: no member row id — it resolves the actor from the session. */
  readonly leave: (input: { readonly workspaceId: string }) => Promise<void>
  readonly changeRole: (input: {
    readonly workspaceId: string
    readonly memberId: string
    readonly role: WorkspaceRole
  }) => Promise<void>
}
