import { invitationStatuses } from '@b2b-saas-starter/db/schema'
import { Context, DateTime, Effect, Option, Schema } from 'effect'

import { type CapabilityUnavailable, MembershipChangeRejected } from '../errors.ts'
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
export const InvitationDetail = Schema.Struct({
  ...Invitation.fields,
  workspaceSlug: Schema.String,
  workspaceName: Schema.String
})
export type InvitationDetail = typeof InvitationDetail.Type

/** What the accept route needs to send the new member on their way. */
export const AcceptedInvitation = Schema.Struct({
  workspaceSlug: Schema.String,
  workspaceName: Schema.String,
  role: WorkspaceRole
})
export type AcceptedInvitation = typeof AcceptedInvitation.Type

export type WorkspaceInvitationsInterface = {
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
   * what to show: `acceptInvitationDetailsServerFn` reveals the workspace only
   * once the signed-in address matches.
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
 */
export function requireRecipient(
  invitation: Invitation,
  email: string
): Effect.Effect<void, MembershipChangeRejected> {
  // The plugin lower-cases both sides before comparing; matching that keeps a
  // mixed-case sign-up from being refused its own invitation.
  if (invitation.email.toLowerCase() !== email.toLowerCase()) {
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
