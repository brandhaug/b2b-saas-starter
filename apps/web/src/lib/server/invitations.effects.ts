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
import { EmailDispatcher } from '@b2b-saas-starter/email'
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
      const invitation = yield* invitations.create({
        email: input.email,
        role: input.role
      })

      // The link carries the invitation id, because that is what the accept
      // path is keyed by. The old `?workspace=<slug>` form could not
      // identify which invitation was being accepted.
      const inviteUrl = `${requestOrigin()}/invitations/accept?invitation=${invitation.id}`
      const recipientPreferences = yield* Effect.flatMap(
        AccountPreferencesService,
        (preferences) => preferences.getByEmail(input.email)
      )
      const locale = recipientPreferences?.locale ?? DEFAULT_LOCALE
      const dispatcher = yield* EmailDispatcher
      const delivery = yield* Effect.result(
        dispatcher.send({
          from: '',
          to: input.email,
          subject: m.backend_email_subject_invitation(
            { workspaceName: ctx.workspace.name },
            { locale }
          ),
          element: WorkspaceInvitationEmail({
            workspaceName: ctx.workspace.name,
            inviteUrl,
            locale
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
    }).pipe(Effect.provide(emailDispatcherLayer())),
    { userId: session.user.id },
    { invitationBinding: webInvitationBinding }
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
