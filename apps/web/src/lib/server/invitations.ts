import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api'
import { makeBrowserClient, dataCall } from '@/http/client'
import { WebErrors } from '@/http/errors'
import * as Responses from '@/http/contracts/invitations'
import { type Invitation } from '@b2b-saas-starter/capabilities/governance/workspace-invitations'
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

  readonly status: 'accepted' | 'logged' | 'skipped' | 'failed'
  readonly inviteUrl: string
}

export type InvitationPreview =
  | {
      readonly state: 'pending'
      readonly invitationId: string
      readonly workspaceName: string
      readonly workspaceSlug: string
      readonly role: Invitation['role']
    }
  | { readonly state: 'unavailable' }

export const Api = HttpApi.make('web-invitations').add(
  HttpApiGroup.make('calls').add(
    HttpApiEndpoint.post('sendInvitationServerFn', '/api/web/sendInvitationServerFn', {
      payload: SendInvitationInput,
      success: Responses.sendInvitationServerFnResponse,
      error: WebErrors
    }),
    HttpApiEndpoint.post(
      'cancelInvitationServerFn',
      '/api/web/cancelInvitationServerFn',
      {
        payload: CancelInvitationInput,
        success: Responses.cancelInvitationServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'resendInvitationServerFn',
      '/api/web/resendInvitationServerFn',
      {
        payload: CancelInvitationInput,
        success: Responses.resendInvitationServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'invitationPreviewServerFn',
      '/api/web/invitationPreviewServerFn',
      {
        payload: AcceptInvitationInput,
        success: Responses.invitationPreviewServerFnResponse,
        error: WebErrors
      }
    ),
    HttpApiEndpoint.post(
      'acceptInvitationServerFn',
      '/api/web/acceptInvitationServerFn',
      {
        payload: AcceptInvitationInput,
        success: Responses.acceptInvitationServerFnResponse,
        error: WebErrors
      }
    )
  )
)

const browser = makeBrowserClient(Api)

export const sendInvitationServerFn = dataCall(
  browser,
  SendInvitationInput,
  (client, payload) => client.calls.sendInvitationServerFn({ payload })
)

export const cancelInvitationServerFn = dataCall(
  browser,
  CancelInvitationInput,
  (client, payload) => client.calls.cancelInvitationServerFn({ payload })
)

export const resendInvitationServerFn = dataCall(
  browser,
  CancelInvitationInput,
  (client, payload) => client.calls.resendInvitationServerFn({ payload })
)

export const acceptInvitationServerFn = dataCall(
  browser,
  AcceptInvitationInput,
  (client, payload) => client.calls.acceptInvitationServerFn({ payload })
)
