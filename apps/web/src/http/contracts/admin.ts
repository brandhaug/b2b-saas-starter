import { Schema } from 'effect'
import { HttpApiSchema } from 'effect/http-api'
import {
  AdminWorkspaces,
  TransitionAdminWorkspaceSchema,
  SystemUsers,
  AuditEventRecords,
  UserWorkspaces,
  ChangeUserWorkspaceRoleSchema,
  LoadFailedDeliveriesSchema
} from './administration-records'

export const listAdminWorkspacesServerFnResponse = AdminWorkspaces
export const transitionAdminWorkspaceServerFnResponse = TransitionAdminWorkspaceSchema
export const listSystemUsersServerFnResponse = SystemUsers
export const loadAdminAuditEventsServerFnResponse = AuditEventRecords
export const banSystemUserServerFnResponse = HttpApiSchema.NoContent
export const unbanSystemUserServerFnResponse = HttpApiSchema.NoContent
export const listUserWorkspacesServerFnResponse = UserWorkspaces
export const changeUserWorkspaceRoleServerFnResponse = ChangeUserWorkspaceRoleSchema
export const impersonateUserServerFnResponse = Schema.Struct({
  userId: Schema.String,
  expiresInSeconds: Schema.Number
})
export const stopImpersonatingServerFnResponse = HttpApiSchema.NoContent
export const loadFailedDeliveriesServerFnResponse = LoadFailedDeliveriesSchema
export const replayFailedDeliveryServerFnResponse = Schema.Union([
  Schema.Struct({ status: Schema.Literal('queued'), deliveryId: Schema.String }),
  Schema.Struct({ status: Schema.Literal('refused'), reason: Schema.String })
])
