import { invitationStatuses } from '@b2b-saas-starter/db/enums'
import { Context, DateTime, Effect, Option, Schema } from 'effect'

import { MembershipChangeRejected } from '../errors.ts'
import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { type WorkspaceContext } from '../workspace-context.ts'
import { WorkspaceRole } from './workspace-identity.ts'

/**
 * The invitations contract: the wire schemas, the service tag, the plugin
 * binding port, and the state-machine rules both adapters enforce. The Seed
 * adapter lives in [`workspace-invitations.seed.ts`](./workspace-invitations.seed.ts),
 * the D1 + plugin-binding adapter in
 * [`workspace-invitations.live.ts`](./workspace-invitations.live.ts).
 */

export const InvitationStatus = Schema.Literals(invitationStatuses)
export type InvitationStatus = typeof InvitationStatus.Type

/**
 * The owner of the `workspace_invitations.status` machine (ADR 0077).
 * Better Auth's organization plugin owns every status write; this module
 * declares the legal transition set both adapters pre-check against and the
 * named predicate sets around it, so Seed and Live refuse the same things
 * without restating the vocabulary. `canceled` is the plugin's single-`l`
 * spelling, kept byte for byte.
 *
 * SQL mirrors that must stay in step, named rather than edited (migration
 * `20260907195706_organic_mercury`):
 * - the `workspace_invitation_terminal_insert` and
 *   `workspace_invitation_terminal_update` triggers stamp `terminalAt` on
 *   every row whose status is not `pending` and clear it on return to
 *   `pending` — terminal means exactly `status <> 'pending'`, which is what
 *   {@link terminalInvitationStatuses} enumerates.
 * - `workspace_invitations_retention_idx` orders retention by
 *   `CASE WHEN status = 'pending' THEN expiresAt ELSE terminalAt END`: a
 *   pending invitation dies by `expiresAt`, a terminal one by `terminalAt`.
 *   The `invitations` rule in `retention-rules.ts` composes that CASE from
 *   these exports.
 */

/** The status a new invitation is born with — the plugin's only creation status. */
export const initialInvitationStatus: InvitationStatus = 'pending'

/** Every status a settled invitation holds. */
export const terminalInvitationStatuses: ReadonlyArray<InvitationStatus> = [
  'accepted',
  'rejected',
  'canceled'
]

export function isPendingInvitation(status: InvitationStatus): boolean {
  return status === initialInvitationStatus
}

/** Terminal exactly as the `terminalAt` triggers decide it: not pending. */
export function isTerminalInvitation(status: InvitationStatus): boolean {
  return !isPendingInvitation(status)
}

/** The ways a pending invitation can settle. */
export type InvitationEvent = 'accepted' | 'rejected' | 'canceled'

/**
 * The declared transition map: `pending` settles to any terminal status,
 * terminal statuses never move. Expiry is time-based, not a transition: a
 * pending invitation past `expiresAt` is refused by `requireUnexpired`, and
 * the row stays `pending` for the retention CASE to age out.
 */
const invitationTransitions = {
  pending: { accepted: 'accepted', rejected: 'rejected', canceled: 'canceled' },
  accepted: { accepted: null, rejected: null, canceled: null },
  rejected: { accepted: null, rejected: null, canceled: null },
  canceled: { accepted: null, rejected: null, canceled: null }
} as const satisfies Record<
  InvitationStatus,
  Record<InvitationEvent, InvitationStatus | null>
>

/**
 * The status an event produces; `null` refuses the event — a settled
 * invitation is done. Seed routes its settle writes through here; Live's
 * writes stay the plugin's, pre-checked through the predicates above.
 */
export function nextInvitationStatus(
  status: InvitationStatus,
  event: InvitationEvent
): InvitationStatus | null {
  return invitationTransitions[status][event]
}

/**
 * A workspace invitation as the UI and the wire see it. The invitee's address
 * is the identity here — the plugin keys acceptance on it, and the invited
 * person has no user row of ours until they accept.
 */
export const Invitation = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  role: WorkspaceRole,
  status: InvitationStatus,
  expiresAt: Schema.String
})
export type Invitation = typeof Invitation.Type

export type CreateInvitationInput = {
  readonly email: string
  readonly role: WorkspaceRole
}

export type InvitationRef = {
  readonly invitationId: string
}

/**
 * Who is accepting. The email rides along because the invitation is addressed
 * to an address, not to a user id: both adapters refuse an invitation the
 * signed-in person is not the recipient of, and Seed has no `user` table to
 * look one up in.
 */
export type AcceptInvitationInput = InvitationRef & {
  readonly userId: string
  readonly email: string
}

/**
 * An invitation plus the workspace it belongs to. The accept page holds only an
 * invitation id — it cannot resolve the workspace by slug, because it is not
 * allowed to look one up until the invitation makes it a member — so the
 * workspace's public fields ride along with the read.
 */
const InvitationDetail = Schema.Struct({
  ...Invitation.fields,
  workspaceId: Schema.String,
  workspaceSlug: Schema.String,
  workspaceName: Schema.String
})
type InvitationDetail = typeof InvitationDetail.Type

/** What the accept route needs to send the new member on their way. */
export const AcceptedInvitation = Schema.Struct({
  workspaceSlug: Schema.String,
  workspaceName: Schema.String,
  role: WorkspaceRole
})
export type AcceptedInvitation = typeof AcceptedInvitation.Type

type WorkspaceInvitationsInterface = {
  /** Every invitation of the current workspace, newest first. */
  readonly list: Effect.Effect<
    ReadonlyArray<Invitation>,
    CapabilityUnavailable,
    WorkspaceContext
  >

  readonly create: (
    input: CreateInvitationInput
  ) => Effect.Effect<
    Invitation,
    CapabilityUnavailable | MembershipChangeRejected,
    WorkspaceContext
  >

  readonly cancel: (
    input: InvitationRef
  ) => Effect.Effect<
    void,
    CapabilityUnavailable | MembershipChangeRejected,
    WorkspaceContext
  >

  /**
   * One invitation by id, with its workspace. No `WorkspaceContext` and no
   * membership check, for the same reason `accept` has neither — this is the
   * read the accept page makes before anyone is a member.
   *
   * It discloses the invited address to whoever holds the id. Callers decide
   * what to show: `invitationPreviewHandler` in `apps/web` reveals the
   * workspace only once {@link requirePending} and {@link requireRecipient}
   * both pass, and collapses every other outcome to one opaque answer.
   */
  readonly find: (
    invitationId: string
  ) => Effect.Effect<Option.Option<InvitationDetail>, CapabilityUnavailable>
  /**
   * Accepts an invitation and makes its recipient a member.
   *
   * Deliberately free of `WorkspaceContext`: the person accepting is not a
   * member yet, and `liveWorkspaceContext(slug, actor)` refuses a non-member by
   * design, so an accept behind it could never succeed. The invitation id is
   * the key, and the workspace is resolved from the invitation itself — the
   * same shape as `WorkspaceMembership.listWorkspacesForUser`, which is keyed
   * by user id for the same reason.
   */
  readonly accept: (
    input: AcceptInvitationInput
  ) => Effect.Effect<
    AcceptedInvitation,
    CapabilityUnavailable | MembershipChangeRejected
  >
}

export class WorkspaceInvitations extends Context.Service<
  WorkspaceInvitations,
  WorkspaceInvitationsInterface
>()('@b2b-saas-starter/capabilities/WorkspaceInvitations') {}

/**
 * The write half of invitations, as this package needs it — a structural port,
 * not the plugin's wire shape, for the same reason `WorkspaceMemberBinding`
 * is one: `capabilities` never names Better Auth, and every invitation
 * endpoint the plugin exposes is `requireHeaders: true`, so only the app can
 * supply the session they demand.
 */
export type WorkspaceInvitationBinding = {
  readonly create: (input: {
    readonly workspaceId: string
    readonly email: string
    readonly role: WorkspaceRole
  }) => Promise<void>
  readonly cancel: (input: { readonly invitationId: string }) => Promise<void>
  /**
   * Takes no user: the plugin reads the accepting user from the session the
   * app's adapter supplies, and refuses an invitation addressed elsewhere.
   */
  readonly accept: (input: { readonly invitationId: string }) => Promise<void>
}

/**
 * The invitation state machine's own rules, written once so both adapters
 * refuse the same things. Live checks them before it calls the plugin: the
 * plugin enforces them too, but only a pre-check makes the capability's answer
 * independent of which binding is wired, and the audit event needs the row
 * anyway.
 *
 * They are pure functions over an {@link Invitation} rather than interface
 * members on purpose: a read that has already fetched the row — the accept
 * page's preview — asks the same three questions the adapters ask, and a
 * `findForRecipient` on the interface would push the filter back into every
 * adapter instead.
 *
 * A settled invitation — accepted, rejected, or cancelled — is done. Both
 * adapters and the accept page's preview refuse it here.
 */
export function requirePending(
  invitation: Invitation
): Effect.Effect<void, MembershipChangeRejected> {
  if (!isPendingInvitation(invitation.status)) {
    return Effect.fail(
      new MembershipChangeRejected({ reason: 'invitation_not_pending' })
    )
  }
  return Effect.void
}

/**
 * The one canonical form of an invited address, applied on every write and
 * every lookup by both adapters.
 *
 * An address is the invitation's identity: `requireRecipient` compares case
 * insensitively, so `Ada@example.test` may accept an invitation addressed to
 * `ada@example.test`. Anything that decides *whether* an address already has
 * a pending invitation has to agree with that, or one person ends up holding
 * two — and D1's default TEXT collation is BINARY, which does not.
 */
export function normalizeInvitationEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function requireRecipient(
  invitation: Invitation,
  email: string
): Effect.Effect<void, MembershipChangeRejected> {
  // The plugin lower-cases both sides before comparing; matching that keeps a
  // mixed-case sign-up from being refused its own invitation.
  if (normalizeInvitationEmail(invitation.email) !== normalizeInvitationEmail(email)) {
    return Effect.fail(new MembershipChangeRejected({ reason: 'not_the_recipient' }))
  }
  return Effect.void
}

export function requireUnexpired(
  invitation: Invitation
): Effect.Effect<void, MembershipChangeRejected> {
  return Effect.gen(function* () {
    const now = yield* DateTime.now
    // Mapping-boundary parse: a malformed stored timestamp must not crash the
    // read path — it lands on the expired rejection like a stale one.
    const parsed = DateTime.make(invitation.expiresAt)
    if (
      Option.isNone(parsed) ||
      DateTime.toEpochMillis(parsed.value) < DateTime.toEpochMillis(now)
    ) {
      return yield* Effect.fail(
        new MembershipChangeRejected({ reason: 'invitation_expired' })
      )
    }
  })
}
