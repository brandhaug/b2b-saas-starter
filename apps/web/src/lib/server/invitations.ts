import {
  type AcceptedInvitation,
  type Invitation
} from '@b2b-saas-starter/capabilities/governance/workspace-invitations'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'

import { workspaceRoles } from '@/lib/permissions'

import { EMAIL_PATTERN } from '../email-pattern'

const SendInvitationInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  email: Schema.String.check(
    Schema.isMinLength(3),
    Schema.isMaxLength(320),
    Schema.isPattern(EMAIL_PATTERN)
  ),
  role: Schema.Literals(workspaceRoles)
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
   * The send outcome, distinct from delivery. The invitation persists either way:
   * it exists once the plugin has written it, and reporting a send failure as an
   * outright error would tell the inviter nothing happened when something did.
   * The form shows the link so they can pass it on by hand.
   */
  readonly status: 'accepted' | 'logged' | 'skipped' | 'failed'
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

export const resendInvitationServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(CancelInvitationInput))
  .handler(async ({ data }): Promise<SentInvitation> => {
    const { resendInvitationHandler } = await import('./invitations.effects')
    return resendInvitationHandler(data)
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
