import { WORKSPACE_ROLES } from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import {
  type AcceptedInvitation,
  type Invitation
} from '@b2b-saas-starter/capabilities/governance/workspace-invitations'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'
import { EMAIL_PATTERN } from '../email-pattern'

/**
 * The workspace-invitation server functions, in a **client-safe** module.
 *
 * This file is statically imported by route files, and the route tree ships to
 * the browser — so everything at this module's top level rides on every page.
 * That is why the capability effects and their imports (the email templates,
 * the Better Auth session gate, the plugin binding) live in
 * `invitations.effects.ts` and are reached only through dynamic `import()`
 * inside each handler: TanStack Start strips handler bodies from the client
 * build, so the effects graph never ships, while the `createServerFn`
 * declarations, the payload types and the input schemas still do.
 *
 * The behaviour itself is tested as the effects (`invitations.test.ts`
 * imports `invitations.effects.ts` directly) — see that file for why the
 * effects take the actor's address, the request origin and the email
 * dispatcher as arguments rather than reading them.
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
    const { sendInvitationHandler } = await import('./invitations.effects')
    return sendInvitationHandler(data)
  })

export const cancelInvitationServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeCancel(input))
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
  .validator((input) => decodeAccept(input))
  .handler(async ({ data }): Promise<InvitationPreview> => {
    const { invitationPreviewHandler } = await import('./invitations.effects')
    return invitationPreviewHandler(data)
  })

export const acceptInvitationServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeAccept(input))
  .handler(async ({ data }): Promise<AcceptedInvitation> => {
    const { acceptInvitationHandler } = await import('./invitations.effects')
    return acceptInvitationHandler(data)
  })
