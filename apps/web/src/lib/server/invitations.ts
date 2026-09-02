import { type AuthorizationDenied } from '@b2b-saas-starter/authz/errors'
import {
  WORKSPACE_ROLES,
  type WorkspaceRole
} from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import {
  requirePending,
  requireRecipient,
  requireUnexpired,
  WorkspaceInvitations,
  type AcceptedInvitation,
  type Invitation
} from '@b2b-saas-starter/capabilities/governance/workspace-invitations'
import {
  type CapabilityUnavailable,
  type MembershipChangeRejected
} from '@b2b-saas-starter/capabilities/errors'
import { EmailDispatcher } from '@b2b-saas-starter/email'
import { WorkspaceInvitationEmail } from '@b2b-saas-starter/email/templates'
import { createServerFn } from '@tanstack/react-start'
import { Effect, Option, Result, Schema, type Scope } from 'effect'
import { runCapabilities, runWorkspaceCapabilities } from '../capabilities'
import { currentRequest } from '../request-context'
import { EMAIL_PATTERN } from '../email-pattern'
import { emailDispatcherLayer } from './auth-emails'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission } from './authorize'
import { webInvitationBinding } from './invitation-binding'

/**
 * The workspace-invitation mutations, as capability effects plus the server
 * functions that run them.
 *
 * Sending and cancelling are ordinary workspace mutations: session gate, then
 * `requireWorkspacePermission`, then the capability. **Accepting is not** — see
 * `acceptInvitation` for why it cannot be.
 *
 * Each effect is exported beside its server function, and takes the actor's
 * address, the request origin and the email dispatcher as inputs rather than
 * reading them: that is what makes the permission gates, the non-disclosure
 * rule and the email-failure fallback testable without a session or an auth
 * runtime (`invitations.test.ts`). The server functions hold the session gate
 * and the wiring, nothing else.
 *
 * All three mutations pass `webInvitationBinding`, because every invitation
 * endpoint the organization plugin exposes needs the request's session and only
 * this app has one (issue #64 settled that the API worker cannot).
 */

// All input constraints live in the schema — no imperative re-validation.
const WorkspaceRoleInput = Schema.Literals(WORKSPACE_ROLES)

const SendInvitationInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  email: Schema.String.check(
    Schema.isMinLength(3),
    Schema.isMaxLength(320),
    Schema.isPattern(EMAIL_PATTERN)
  ),
  role: WorkspaceRoleInput
})

const CancelInvitationInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  invitationId: Schema.NonEmptyString
})

const AcceptInvitationInput = Schema.Struct({
  invitationId: Schema.NonEmptyString
})

const decodeSend = Schema.decodeUnknownSync(SendInvitationInput)
const decodeCancel = Schema.decodeUnknownSync(CancelInvitationInput)
const decodeAccept = Schema.decodeUnknownSync(AcceptInvitationInput)

/**
 * Absolute origin of the in-flight request, so the emailed link is clickable.
 * Empty when there is no request, which keeps the URL relative rather than
 * pointing at a fabricated host.
 */
function requestOrigin(): string {
  const request = currentRequest()
  if (!request) {
    return ''
  }
  return new URL(request.url).origin
}

export type SentInvitation = {
  readonly invitation: Invitation
  /**
   * Whether the invite email went out. The invitation is persisted either way:
   * it exists once the plugin has written it, and reporting a send failure as an
   * outright error would tell the inviter nothing happened when something did.
   * The form shows the link so they can pass it on by hand.
   */
  readonly delivered: boolean
  readonly inviteUrl: string
}

export function sendInvitation(input: {
  readonly email: string
  readonly role: WorkspaceRole
  /** Absolute origin for the emailed link; empty keeps the link relative. */
  readonly origin: string
}): Effect.Effect<
  SentInvitation,
  AuthorizationDenied | CapabilityUnavailable | MembershipChangeRejected,
  Scope.Scope | WorkspaceContext | WorkspaceInvitations | EmailDispatcher
> {
  return Effect.gen(function* () {
    // The session gate in the server function proves who is asking; this proves
    // they may.
    yield* requireWorkspacePermission({ invitation: ['create'] })
    const ctx = yield* WorkspaceContext
    const invitations = yield* WorkspaceInvitations
    const invitation = yield* invitations.create({
      email: input.email,
      role: input.role
    })

    // The link carries the invitation id, because that is what the accept path
    // is keyed by. The old `?workspace=<slug>` form could not identify which
    // invitation was being accepted.
    const inviteUrl = `${input.origin}/invitations/accept?invitation=${invitation.id}`
    const dispatcher = yield* EmailDispatcher
    const delivery = yield* Effect.result(
      dispatcher.send({
        from: '',
        to: input.email,
        subject: `You are invited to ${ctx.workspace.name}`,
        element: WorkspaceInvitationEmail({
          workspaceName: ctx.workspace.name,
          inviteUrl
        })
      })
    )
    if (Result.isFailure(delivery)) {
      yield* Effect.annotateLogsScoped({
        outcome: 'invitation_email_failed',
        emailError: delivery.failure.message
      })
      return { invitation, delivered: false, inviteUrl }
    }
    return { invitation, delivered: true, inviteUrl }
  })
}

export const sendInvitationServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeSend(input))
  .handler(async ({ data }): Promise<SentInvitation> => {
    const session = await requireRequestSession()
    return runWorkspaceCapabilities(
      data.workspaceSlug,
      sendInvitation({
        email: data.email,
        role: data.role,
        origin: requestOrigin()
      }).pipe(Effect.provide(emailDispatcherLayer())),
      { userId: session.user.id },
      { invitationBinding: webInvitationBinding }
    )
  })

export function cancelInvitation(input: {
  readonly invitationId: string
}): Effect.Effect<
  void,
  AuthorizationDenied | CapabilityUnavailable | MembershipChangeRejected,
  Scope.Scope | WorkspaceContext | WorkspaceInvitations
> {
  return Effect.gen(function* () {
    yield* requireWorkspacePermission({ invitation: ['cancel'] })
    const invitations = yield* WorkspaceInvitations
    yield* invitations.cancel({ invitationId: input.invitationId })
  })
}

export const cancelInvitationServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeCancel(input))
  .handler(async ({ data }): Promise<void> => {
    const session = await requireRequestSession()
    return runWorkspaceCapabilities(
      data.workspaceSlug,
      cancelInvitation({ invitationId: data.invitationId }),
      { userId: session.user.id },
      { invitationBinding: webInvitationBinding }
    )
  })

/**
 * What the accept page may show the person holding the link.
 *
 * `pending` is the only variant carrying workspace detail, and only the
 * addressee ever sees it: an invitation id is a URL parameter, so anything
 * disclosed for a mismatched address would leak which workspaces exist to
 * whoever can guess an id. Every other outcome — unknown id, already settled,
 * expired, addressed to somebody else — collapses to one opaque answer for the
 * same reason `liveWorkspaceContext` returns `WorkspaceNotFound` to a
 * non-member rather than a 403.
 */
export type InvitationPreview =
  | {
      readonly state: 'pending'
      readonly invitationId: string
      readonly workspaceName: string
      readonly workspaceSlug: string
      readonly role: Invitation['role']
    }
  | { readonly state: 'unavailable' }

const UNAVAILABLE: InvitationPreview = { state: 'unavailable' }

export function invitationPreview(input: {
  readonly invitationId: string
  /** The signed-in address. Only its own invitation is ever described to it. */
  readonly viewerEmail: string
}): Effect.Effect<InvitationPreview, CapabilityUnavailable, WorkspaceInvitations> {
  return Effect.gen(function* () {
    const invitations = yield* WorkspaceInvitations
    const found = yield* invitations.find(input.invitationId)
    if (Option.isNone(found)) {
      return UNAVAILABLE
    }
    const invitation = found.value
    // The rules are the capability's, not this module's: these are the same
    // three the adapters run before an accept, so the page cannot describe an
    // invitation the accept would then refuse. Their typed refusals are
    // collapsed here — the reason never leaves this function, which is what
    // makes every failure one opaque answer.
    const usable = yield* Effect.result(
      Effect.andThen(
        requirePending(invitation),
        Effect.andThen(
          requireRecipient(invitation, input.viewerEmail),
          requireUnexpired(invitation)
        )
      )
    )
    if (Result.isFailure(usable)) {
      return UNAVAILABLE
    }
    return {
      state: 'pending',
      invitationId: invitation.id,
      workspaceName: invitation.workspaceName,
      workspaceSlug: invitation.workspaceSlug,
      role: invitation.role
    }
  })
}

export const invitationPreviewServerFn = createServerFn({ method: 'GET' })
  .validator((input) => decodeAccept(input))
  .handler(async ({ data }): Promise<InvitationPreview> => {
    const session = await requireRequestSession()
    return runCapabilities(
      invitationPreview({
        invitationId: data.invitationId,
        viewerEmail: session.user.email
      })
    )
  })

/**
 * Accepting is the one workspace write with no workspace gate, and it has to be.
 *
 * `runWorkspaceCapabilities` resolves the workspace through
 * `liveWorkspaceContext(slug, actor)`, which answers `WorkspaceNotFound` for an
 * actor who is not a member — and the person accepting an invitation is never a
 * member yet. Membership is what accepting *creates*. So this runs through
 * `runCapabilities`, with no `WorkspaceContext` and no
 * `requireWorkspacePermission`: the invitation itself is the authorization, and
 * both the capability and the plugin refuse one addressed to anybody else.
 *
 * The session is still required — an anonymous visitor has no address to match
 * against the invitation.
 */
export function acceptInvitation(input: {
  readonly invitationId: string
  readonly userId: string
  readonly email: string
}): Effect.Effect<
  AcceptedInvitation,
  CapabilityUnavailable | MembershipChangeRejected,
  WorkspaceInvitations
> {
  return Effect.flatMap(WorkspaceInvitations, (invitations) =>
    invitations.accept({
      invitationId: input.invitationId,
      userId: input.userId,
      email: input.email
    })
  )
}

export const acceptInvitationServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeAccept(input))
  .handler(async ({ data }): Promise<AcceptedInvitation> => {
    const session = await requireRequestSession()
    return runCapabilities(
      acceptInvitation({
        invitationId: data.invitationId,
        userId: session.user.id,
        email: session.user.email
      }),
      { invitationBinding: webInvitationBinding }
    )
  })
