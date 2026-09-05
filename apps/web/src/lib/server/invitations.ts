import {
  type AcceptedInvitation,
  type Invitation
} from '@b2b-saas-starter/capabilities/governance/workspace-invitations'
import { type WorkspaceRole } from '@b2b-saas-starter/capabilities/governance/workspace-identity'
import { createServerFn } from '@tanstack/react-start'
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
 * build, so the effects graph never ships. The validators are stripped the
 * same way handler bodies are — `.validator()` runs on the server only — so
 * the plain shape checks below are the server's first decode, a wire-shape
 * gate that declares each fn's input type without dragging the Effect
 * Schema chunk onto the route tree, while the strict schemas (role
 * literals, email bounds) decode again in the effects file before anything
 * runs.
 *
 * The behaviour itself is tested as the effects (`invitations.test.ts`
 * imports `invitations.effects.ts` directly) — see that file for why
 * the effects take the actor's address, the request origin and the email
 * dispatcher as arguments rather than reading them.
 */

/** Input shape of `sendInvitationServerFn`, for its client stub. */
type SendInvitationInput = {
  readonly workspaceSlug: string
  readonly email: string
  readonly role: WorkspaceRole
}

type CancelInvitationInput = {
  readonly workspaceSlug: string
  readonly invitationId: string
}

type AcceptInvitationInput = {
  readonly invitationId: string
}

/**
 * The server fns' validators, plain shape checks that run server-side only
 * (TanStack strips `.validator()` from the client build): they are the
 * server's first decode, a wire-shape gate, and the strict schemas — role
 * literals, email bounds — decode again in `invitations.effects.ts`; these
 * probes ARE the I/O boundary, so `unknown` in and `throw` out is the
 * contract, the same exemption `pickOptionalStrings` carries (lib/utils.ts).
 */
// oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type, effect/noThrowStatement, effect/noNewError, unicorn/prefer-type-error, effect/noAs, typescript/no-unsafe-type-assertion
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function inputRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error('Invalid invitation input')
  }
  return value
}

function inputString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string') {
    throw new Error(`Invalid invitation input: ${key}`)
  }
  return value
}

function decodeSend(input: unknown): SendInvitationInput {
  const record = inputRecord(input)
  const email = inputString(record, 'email')
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error('Invalid invitation input: email')
  }
  // SAFETY: the strict schema in `invitations.effects.ts` re-decodes the
  // role against the literal tuple before anything runs; this check only
  // establishes the wire shape for the client stub's type.
  return {
    workspaceSlug: inputString(record, 'workspaceSlug'),
    email,
    role: inputString(record, 'role') as SendInvitationInput['role']
  }
}

function decodeCancel(input: unknown): CancelInvitationInput {
  const record = inputRecord(input)
  return {
    workspaceSlug: inputString(record, 'workspaceSlug'),
    invitationId: inputString(record, 'invitationId')
  }
}

function decodeAccept(input: unknown): AcceptInvitationInput {
  return { invitationId: inputString(inputRecord(input), 'invitationId') }
}
// oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type, effect/noThrowStatement, effect/noNewError, unicorn/prefer-type-error, effect/noAs, typescript/no-unsafe-type-assertion

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
  .validator(decodeSend)
  .handler(async ({ data }): Promise<SentInvitation> => {
    const { sendInvitationHandler } = await import('./invitations.effects')
    return sendInvitationHandler(data)
  })

export const cancelInvitationServerFn = createServerFn({ method: 'POST' })
  .validator(decodeCancel)
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
  .validator(decodeAccept)
  .handler(async ({ data }): Promise<InvitationPreview> => {
    const { invitationPreviewHandler } = await import('./invitations.effects')
    return invitationPreviewHandler(data)
  })

export const acceptInvitationServerFn = createServerFn({ method: 'POST' })
  .validator(decodeAccept)
  .handler(async ({ data }): Promise<AcceptedInvitation> => {
    const { acceptInvitationHandler } = await import('./invitations.effects')
    return acceptInvitationHandler(data)
  })
