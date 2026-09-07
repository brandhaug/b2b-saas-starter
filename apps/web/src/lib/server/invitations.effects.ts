import { WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import { AccountPreferencesService } from '@b2b-saas-starter/capabilities/governance/account-preferences'
import {
  requirePending,
  requireRecipient,
  requireUnexpired,
  WorkspaceInvitations,
  type AcceptedInvitation,
  type Invitation
} from '@b2b-saas-starter/capabilities/governance/workspace-invitations'
import { dispatchTrackedEmail } from '@b2b-saas-starter/email/tracked'
import {
  EmailDelivery,
  canResendInvitation
} from '@b2b-saas-starter/capabilities/email-delivery/email-delivery'
import {
  MembershipChangeRejected,
  CapabilityUnavailable
} from '@b2b-saas-starter/capabilities/errors'
import { env } from 'cloudflare:workers'
import { RateLimiter, makeRateLimiterLayer } from '../rate-limit'
import { WorkspaceInvitationEmail } from '@b2b-saas-starter/email/templates'
import * as m from '@b2b-saas-starter/i18n/messages'
import { DEFAULT_LOCALE } from '@b2b-saas-starter/i18n/locale'
import { Effect, Option, Result } from 'effect'
import { runCapabilities, runWorkspaceCapabilities } from '../capabilities'
import { requestOrigin } from './request-origin'
import { emailDispatcherLayer } from './auth-emails'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission } from './authorize'
import { webInvitationBinding } from './invitation-binding'
import {
  type AcceptInvitationInput,
  type CancelInvitationInput,
  type InvitationPreview,
  type SendInvitationInput,
  type SentInvitation
} from './invitations'

/**
 * The invitation effects and their server-only wiring, reached only through
 * dynamic `import()` inside the handlers of `invitations.ts` (see
 * apps/web/AGENTS.md for the split).
 *
 * Each handler reads the session once (the actor's address for the preview
 * and accept matching) and the request origin for the emailed link, then
 * runs the permission gate and the hand-off to the invitation capability
 * inside the effect — the non-disclosure rule and the email-failure
 * fallback included (`invitations.test.ts`).
 *
 * All three mutations pass `webInvitationBinding`, because every invitation
 * endpoint the organization plugin exposes needs the request's session and only
 * this app has one (issue #64 settled that the API worker cannot).
 */

export async function sendInvitationHandler(
  input: SendInvitationInput
): Promise<SentInvitation> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      // The session gate above proves who is asking; this proves they may.
      yield* requireWorkspacePermission({ invitation: ['create'] })
      const ctx = yield* WorkspaceContext
      const invitations = yield* WorkspaceInvitations
      yield* limitInvitationSend(session.user.id)
      const invitation = yield* invitations.create({
        email: input.email,
        role: input.role
      })

      return yield* dispatchInvitation(
        invitation,
        ctx.workspace,
        `invitation:${invitation.id}:0`
      )
    }).pipe(Effect.provide(emailDispatcherLayer())),
    { userId: session.user.id },
    { invitationBinding: webInvitationBinding }
  )
}

const limitInvitationSend = Effect.fn('Invitation.limitSend')(
  function* (userId: string) {
    const limiter = yield* RateLimiter
    if (
      !(yield* limiter.take({ bucket: 'auth_sign_in', key: `invitation:${userId}` }))
    ) {
      return yield* Effect.fail(
        new CapabilityUnavailable({
          capability: 'email-delivery',
          reason: 'rate_limited'
        })
      )
    }
  },
  Effect.provide(makeRateLimiterLayer(env))
)

const dispatchInvitation = Effect.fn('Invitation.dispatch')(function* (
  invitation: Invitation,
  workspace: { readonly id: string; readonly name: string },
  deliveryId: string
) {
  const inviteUrl = `${requestOrigin()}/invitations/accept?invitation=${invitation.id}`
  const preferences = yield* AccountPreferencesService
  const recipientPreferences = yield* preferences.getByEmail(invitation.email)
  const locale = recipientPreferences?.locale ?? DEFAULT_LOCALE
  const history = yield* EmailDelivery
  const userId = yield* history.resolveUserId(invitation.email)
  const result = yield* Effect.result(
    dispatchTrackedEmail(
      {
        id: deliveryId,
        purpose: 'invitation',
        recipient: invitation.email,
        userId,
        workspaceId: workspace.id,
        referenceId: invitation.id
      },
      {
        from: '',
        to: invitation.email,
        subject: m.backend_email_subject_invitation(
          { workspaceName: workspace.name },
          { locale }
        ),
        element: WorkspaceInvitationEmail({
          workspaceName: workspace.name,
          inviteUrl,
          locale
        })
      }
    )
  )
  const status = Result.isFailure(result) ? 'failed' : result.success.status
  return { invitation, status, inviteUrl } satisfies SentInvitation
})

export async function resendInvitationHandler(
  input: CancelInvitationInput
): Promise<SentInvitation> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      yield* requireWorkspacePermission({ invitation: ['create'] })
      yield* limitInvitationSend(session.user.id)
      const invitations = yield* WorkspaceInvitations
      const invitation = (yield* invitations.list).find(
        (candidate) => candidate.id === input.invitationId
      )
      if (invitation === undefined) {
        return yield* Effect.fail(
          new MembershipChangeRejected({ reason: 'invitation_not_found' })
        )
      }
      yield* requirePending(invitation)
      yield* requireUnexpired(invitation)
      const history = yield* EmailDelivery
      const latest = yield* history.latestInvitation(invitation.id)
      if (!canResendInvitation(latest)) {
        return yield* Effect.fail(
          new CapabilityUnavailable({
            capability: 'email-delivery',
            reason: 'provider_refused_recipient'
          })
        )
      }
      const ctx = yield* WorkspaceContext
      // Concurrent requests that observed the same failure claim the same next
      // message. Hashing keeps the ID bounded across repeated manual retries.
      let deliveryId = `invitation:${invitation.id}:0`
      if (latest !== null) {
        const digest = yield* Effect.promise(() =>
          crypto.subtle.digest('SHA-256', new TextEncoder().encode(latest.id))
        )
        const digestId = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, '0')
        ).join('')
        deliveryId = `invitation:${invitation.id}:retry:${digestId}`
      }
      return yield* dispatchInvitation(invitation, ctx.workspace, deliveryId)
    }).pipe(Effect.provide(emailDispatcherLayer())),
    { userId: session.user.id }
  )
}

export async function cancelInvitationHandler(
  input: CancelInvitationInput
): Promise<void> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      yield* requireWorkspacePermission({ invitation: ['cancel'] })
      const invitations = yield* WorkspaceInvitations
      yield* invitations.cancel({ invitationId: input.invitationId })
    }),
    { userId: session.user.id },
    { invitationBinding: webInvitationBinding }
  )
}

const UNAVAILABLE: InvitationPreview = { state: 'unavailable' }

/**
 * The non-disclosure collapse the accept page rides on. The rules are the
 * capability's, not this module's — the same three the adapters run before
 * an accept, so the page cannot describe an invitation the accept would then
 * refuse — and every typed refusal dies here, so the reason never leaves
 * this function. Exported beside the handler so the collapse itself is
 * testable with staged fixtures (a wrong recipient must answer exactly what
 * an unknown id answers).
 */
export function previewInvitation(
  invitation: Invitation & {
    readonly workspaceSlug: string
    readonly workspaceName: string
  },
  viewerEmail: string
): Effect.Effect<InvitationPreview> {
  return Effect.match(
    Effect.andThen(
      requirePending(invitation),
      Effect.andThen(
        requireRecipient(invitation, viewerEmail),
        requireUnexpired(invitation)
      )
    ),
    {
      onSuccess: () => ({
        state: 'pending',
        invitationId: invitation.id,
        workspaceName: invitation.workspaceName,
        workspaceSlug: invitation.workspaceSlug,
        role: invitation.role
      }),
      onFailure: () => UNAVAILABLE
    }
  )
}

export async function invitationPreviewHandler(
  input: AcceptInvitationInput
): Promise<InvitationPreview> {
  // The signed-in address is the only viewer an invitation is ever described
  // to.
  const session = await requireRequestSession()
  return runCapabilities(
    Effect.gen(function* () {
      const invitations = yield* WorkspaceInvitations
      const found = yield* invitations.find(input.invitationId)
      if (Option.isNone(found)) {
        return UNAVAILABLE
      }
      return yield* previewInvitation(found.value, session.user.email)
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
export async function acceptInvitationHandler(
  input: AcceptInvitationInput
): Promise<AcceptedInvitation> {
  const session = await requireRequestSession()
  return runCapabilities(
    Effect.flatMap(WorkspaceInvitations, (invitations) =>
      invitations.accept({
        invitationId: input.invitationId,
        userId: session.user.id,
        email: session.user.email
      })
    ),
    { invitationBinding: webInvitationBinding }
  )
}
