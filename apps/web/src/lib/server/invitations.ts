import { env as cloudflareEnv } from 'cloudflare:workers'
import { createServerFn } from '@tanstack/react-start'
import { Effect, Option, Result, Schema } from 'effect'
import {
  WORKSPACE_ROLES,
  WorkspaceContext,
  WorkspaceInvitations,
  type AcceptedInvitation,
  type Invitation
} from '@b2b-saas-starter/capabilities'
import {
  EmailDispatcher,
  selectEmailDispatcherLayer,
  WorkspaceInvitationEmail,
  type SendEmailBinding
} from '@b2b-saas-starter/email'
import { annotateWide } from '@b2b-saas-starter/logger'
import { runCapabilities, runWorkspaceCapabilities } from '../capabilities'
import { currentRequest } from '../request-context'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission } from './authorize'
import { webInvitationBinding } from './invitation-binding'

/**
 * The workspace-invitation mutations, as server functions.
 *
 * Sending and cancelling are ordinary workspace mutations: session gate, then
 * `requireWorkspacePermission`, then the capability. **Accepting is not** — see
 * `acceptInvitationServerFn` for why it cannot be.
 *
 * All three pass `webInvitationBinding`, because every invitation endpoint the
 * organization plugin exposes needs the request's session and only this app has
 * one (the API worker's half is ticket #64).
 */

// All input constraints live in the schema — no imperative re-validation.
const WorkspaceRoleInput = Schema.Literals(WORKSPACE_ROLES)

const SendInvitationInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  email: Schema.String.check(
    Schema.isMinLength(3),
    Schema.isMaxLength(320),
    Schema.isPattern(/^[^\s@]+@[^\s@]+$/)
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
 * Provider-light by the same selector the API worker uses: with no `EMAIL`
 * binding configured this is the logging dispatcher, so the invite flow works
 * end to end locally and in tests without an email provider (CLAUDE.md rule 3).
 */
function emailDispatcherLayer() {
  const emailEnv: { EMAIL?: SendEmailBinding; EMAIL_FROM_ADDRESS?: string } = {}
  if (cloudflareEnv.EMAIL) emailEnv.EMAIL = cloudflareEnv.EMAIL
  if (cloudflareEnv.CLOUDFLARE_EMAIL_FROM) {
    emailEnv.EMAIL_FROM_ADDRESS = cloudflareEnv.CLOUDFLARE_EMAIL_FROM
  }
  return selectEmailDispatcherLayer(emailEnv)
}

/**
 * Absolute origin of the in-flight request, so the emailed link is clickable.
 * Empty when there is no request, which keeps the URL relative rather than
 * pointing at a fabricated host — the same choice `apps/api` makes.
 */
function requestOrigin(): string {
  const request = currentRequest()
  if (!request) return ''
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

export const sendInvitationServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeSend(input))
  .handler(async ({ data }): Promise<SentInvitation> => {
    const session = await requireRequestSession()
    return runWorkspaceCapabilities(
      data.workspaceSlug,
      Effect.gen(function* () {
        // The session gate above proves who is asking; this proves they may.
        yield* requireWorkspacePermission({ invitation: ['create'] })
        const ctx = yield* WorkspaceContext
        const invitations = yield* WorkspaceInvitations
        const invitation = yield* invitations.create({
          email: data.email,
          role: data.role
        })

        // The link carries the invitation id, because that is what the accept
        // path is keyed by. The old `?workspace=<slug>` form could not identify
        // which invitation was being accepted.
        const inviteUrl = `${requestOrigin()}/invitations/accept?invitation=${invitation.id}`
        const dispatcher = yield* EmailDispatcher
        const delivery = yield* Effect.result(
          dispatcher.send({
            from: '',
            to: data.email,
            subject: `You are invited to ${ctx.workspace.name}`,
            element: WorkspaceInvitationEmail({
              workspaceName: ctx.workspace.name,
              inviteUrl
            })
          })
        )
        if (Result.isFailure(delivery)) {
          yield* annotateWide({
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
  })

export const cancelInvitationServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeCancel(input))
  .handler(async ({ data }): Promise<void> => {
    const session = await requireRequestSession()
    return runWorkspaceCapabilities(
      data.workspaceSlug,
      Effect.gen(function* () {
        yield* requireWorkspacePermission({ invitation: ['cancel'] })
        const invitations = yield* WorkspaceInvitations
        yield* invitations.cancel({ invitationId: data.invitationId })
      }),
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

export const invitationPreviewServerFn = createServerFn({ method: 'GET' })
  .validator((input) => decodeAccept(input))
  .handler(async ({ data }): Promise<InvitationPreview> => {
    const session = await requireRequestSession()
    return runCapabilities(
      Effect.gen(function* () {
        const invitations = yield* WorkspaceInvitations
        const found = yield* invitations.find(data.invitationId)
        if (Option.isNone(found)) return UNAVAILABLE
        const invitation = found.value
        if (invitation.status !== 'pending') return UNAVAILABLE
        if (invitation.email.toLowerCase() !== session.user.email.toLowerCase()) {
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
export const acceptInvitationServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeAccept(input))
  .handler(async ({ data }): Promise<AcceptedInvitation> => {
    const session = await requireRequestSession()
    return runCapabilities(
      Effect.gen(function* () {
        const invitations = yield* WorkspaceInvitations
        return yield* invitations.accept({
          invitationId: data.invitationId,
          userId: session.user.id,
          email: session.user.email
        })
      }),
      { invitationBinding: webInvitationBinding }
    )
  })
