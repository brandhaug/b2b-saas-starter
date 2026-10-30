import { Schema } from 'effect'
import { HttpApiSchema } from 'effect/http-api'
import { ResendInvitationSchema, InvitationPreviewResult } from './membership-records'

export const sendInvitationServerFnResponse = ResendInvitationSchema
export const cancelInvitationServerFnResponse = HttpApiSchema.NoContent
export const resendInvitationServerFnResponse = ResendInvitationSchema
export const invitationPreviewServerFnResponse = InvitationPreviewResult
export const acceptInvitationServerFnResponse = Schema.Struct({
  workspaceSlug: Schema.String,
  workspaceName: Schema.String,
  role: Schema.Union([
    Schema.Literal('owner'),
    Schema.Literal('admin'),
    Schema.Literal('member')
  ])
})
