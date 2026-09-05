import {
  type AcceptedInvitation,
  type Invitation
} from '@b2b-saas-starter/capabilities/governance/workspace-invitations'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'

import { WORKSPACE_ROLES } from '@/lib/permissions'

import { EMAIL_PATTERN } from '../email-pattern'

/**
 * The workspace-invitation server functions, in a **client-safe** module —
 * the client-safe half of the `invitations.effects.ts` split; see
 * apps/web/AGENTS.md for the rule and `scripts/assert-client-boundary.mjs`
 * for the enforcement. Each input is written once, as its Effect Schema: the
 * validator is the single strict decode, and the derived type types both the
 * client stub and the effects handler.
 *
 * The behaviour itself is tested as the effects (`invitations.test.ts`
 * imports `invitations.effects.ts` directly) — see that file for why the
 * effects take the actor's address, the request origin and the email
 * dispatcher as arguments rather than reading them.
 */

const SendInvitationInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  email: Schema.String.check(
    Schema.isMinLength(3),
    Schema.isMaxLength(320),
    Schema.isPattern(EMAIL_PATTERN)
  ),
  role: Schema.Literals(WORKSPACE_ROLES)
})

const CancelInvitationInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  invitationId: Schema.NonEmptyString
})

const AcceptInvitationInput = Schema.Struct({
  invitationId: Schema.NonEmptyString
})

export type SendInvitationInput = typeof SendInvitationInput.Type
export type CancelInvitationInput = typeof CancelInvitationInput.Type
export type AcceptInvitationInput = typeof AcceptInvitationInput.Type

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
  .validator(Schema.decodeUnknownSync(SendInvitationInput))
  .handler(async ({ data }): Promise<SentInvitation> => {
    const { sendInvitationHandler } = await import('./invitations.effects')
    return sendInvitationHandler(data)
  })

export const cancelInvitationServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(CancelInvitationInput))
  .handler(async ({ data }): Promise<void> => {
    const { cancelInvitationHandler } = await import('./invitations.effects')
    return cancelInvitationHandler(data)
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

export const invitationPreviewServerFn = createServerFn({ method: 'GET' })
  .validator(Schema.decodeUnknownSync(AcceptInvitationInput))
  .handler(async ({ data }): Promise<InvitationPreview> => {
    const { invitationPreviewHandler } = await import('./invitations.effects')
    return invitationPreviewHandler(data)
  })

export const acceptInvitationServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(AcceptInvitationInput))
  .handler(async ({ data }): Promise<AcceptedInvitation> => {
    const { acceptInvitationHandler } = await import('./invitations.effects')
    return acceptInvitationHandler(data)
  })
