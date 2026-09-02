import { type AuthorizationDenied } from '@b2b-saas-starter/authz/errors'
import { WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import {
  requirePending,
  requireRecipient,
  requireUnexpired,
  WorkspaceInvitations,
  type AcceptedInvitation
} from '@b2b-saas-starter/capabilities/governance/workspace-invitations'
import {
  type CapabilityUnavailable,
  type MembershipChangeRejected
} from '@b2b-saas-starter/capabilities/errors'
import { EmailDispatcher } from '@b2b-saas-starter/email'
import { WorkspaceInvitationEmail } from '@b2b-saas-starter/email/templates'
import { Effect, Option, Result, type Scope } from 'effect'
import { type WorkspaceRole } from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { runCapabilities, runWorkspaceCapabilities } from '../capabilities'
import { currentRequest } from '../request-context'
import { emailDispatcherLayer } from './auth-emails'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission } from './authorize'
import { webInvitationBinding } from './invitation-binding'
import { type InvitationPreview, type SentInvitation } from './invitations'

/**
 * The invitation effects and their server-only wiring.
 *
 * Everything imported at this module's top level — the react-email template,
 * the email dispatcher layer, the Better Auth session gate, the plugin
 * binding — must never reach the browser bundle. That is why this file is
 * reached only through dynamic `import()` inside the `createServerFn`
 * handlers in `invitations.ts`: handler bodies are stripped from the client
 * build, so this graph ships to the server alone.
 *
 * The split of behaviour vs. wiring follows the AGENTS.md reference: each
 * effect takes the actor's address, the request origin and the email
 * dispatcher as inputs rather than reading them, which is what makes the
 * permission gates, the non-disclosure rule and the email-failure fallback
 * testable without a session or an auth runtime (`invitations.test.ts`). Each
 * `…Handler` adds the session gate and the wiring, nothing else.
 *
 * All three mutations pass `webInvitationBinding`, because every invitation
 * endpoint the organization plugin exposes needs the request's session and only
 * this app has one (issue #64 settled that the API worker cannot).
 */

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

export async function sendInvitationHandler(data: {
  readonly workspaceSlug: string
  readonly email: string
  readonly role: WorkspaceRole
}): Promise<SentInvitation> {
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
}

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

export async function cancelInvitationHandler(data: {
  readonly workspaceSlug: string
  readonly invitationId: string
}): Promise<void> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    data.workspaceSlug,
    cancelInvitation({ invitationId: data.invitationId }),
    { userId: session.user.id },
    { invitationBinding: webInvitationBinding }
  )
}

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

export async function invitationPreviewHandler(data: {
  readonly invitationId: string
}): Promise<InvitationPreview> {
  const session = await requireRequestSession()
  return runCapabilities(
    invitationPreview({
      invitationId: data.invitationId,
      viewerEmail: session.user.email
    })
  )
}

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

export async function acceptInvitationHandler(data: {
  readonly invitationId: string
}): Promise<AcceptedInvitation> {
  const session = await requireRequestSession()
  return runCapabilities(
    acceptInvitation({
      invitationId: data.invitationId,
      userId: session.user.id,
      email: session.user.email
    }),
    { invitationBinding: webInvitationBinding }
  )
}
