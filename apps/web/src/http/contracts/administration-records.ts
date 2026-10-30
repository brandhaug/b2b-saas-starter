import { Schema } from 'effect'

export const FailedWebhookDelivery = Schema.Struct({
  id: Schema.String,
  endpointId: Schema.String,
  endpointUrl: Schema.String,
  endpointEnabled: Schema.Boolean,
  endpointConsecutiveFailures: Schema.Number,
  endpointFailureLimitReached: Schema.Boolean,
  eventType: Schema.String,
  status: Schema.String,
  attempts: Schema.Number,
  lastAttemptAt: Schema.Union([Schema.Null, Schema.String]),
  responseStatus: Schema.Union([Schema.Null, Schema.Number]),
  workspace: Schema.Struct({
    id: Schema.String,
    slug: Schema.String,
    name: Schema.String,
    planId: Schema.String
  })
})

export const FailedWebhookDeliveries = Schema.Array(FailedWebhookDelivery)

export const LoadFailedDeliveriesSchema = Schema.Struct({
  items: FailedWebhookDeliveries,
  nextCursor: Schema.Union([Schema.Null, Schema.String])
})

export const ChangeUserWorkspaceRoleSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  role: Schema.Union([
    Schema.Literal('owner'),
    Schema.Literal('admin'),
    Schema.Literal('member')
  ]),
  systemRole: Schema.Union([Schema.Literal('admin'), Schema.Literal('user')]),
  banned: Schema.Boolean
})

export const ListUserWorkspacesSchema = Schema.Struct({
  workspace: Schema.Struct({
    id: Schema.String,
    slug: Schema.String,
    name: Schema.String,
    planId: Schema.String
  }),
  member: ChangeUserWorkspaceRoleSchema
})

export const UserWorkspaces = Schema.Array(ListUserWorkspacesSchema)

export const AuditEventRecord = Schema.Struct({
  id: Schema.String,
  eventType: Schema.String,
  targetType: Schema.String,
  targetId: Schema.Union([Schema.Null, Schema.String]),
  actor: Schema.String,
  actorType: Schema.String,
  createdAt: Schema.String
})

export const AuditEventRecords = Schema.Array(AuditEventRecord)

export const ListSystemUsersSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  role: Schema.Union([Schema.Literal('admin'), Schema.Literal('user')]),
  banned: Schema.Boolean
})

export const SystemUsers = Schema.Array(ListSystemUsersSchema)

export const TransitionAdminWorkspaceSchema = Schema.Struct({
  workspaceId: Schema.String,
  status: Schema.Union([Schema.Literal('active'), Schema.Literal('suspended')]),
  customerExplanation: Schema.Union([Schema.Null, Schema.String]),
  changedAt: Schema.Union([Schema.Null, Schema.String]),
  changedByUserId: Schema.Union([Schema.Null, Schema.String])
})

export const ListAdminWorkspacesSchema = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  suspension: TransitionAdminWorkspaceSchema
})

export const AdminWorkspaces = Schema.Array(ListAdminWorkspacesSchema)
