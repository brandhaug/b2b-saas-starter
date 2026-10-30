import { Schema } from 'effect'

export const KindSchema = Schema.Union([
  Schema.Literal('api_token.created'),
  Schema.Literal('api_token.revoked'),
  Schema.Literal('workspace_member.role_changed'),
  Schema.Literal('two_factor.changed'),
  Schema.Literal('webhook.delivery_failed'),
  Schema.Literal('workspace_member.joined'),
  Schema.Literal('billing.plan_changed'),
  Schema.Literal('account.impersonated'),
  Schema.Literal('announcement')
])

export const SuspensionNotificationEvent = Schema.Struct({
  type: Schema.Literal('workspace.suspension_changed'),
  status: Schema.Union([Schema.Literal('active'), Schema.Literal('suspended')]),
  customerExplanation: Schema.Union([Schema.Null, Schema.String])
})

export const NotificationEvent = Schema.Union([
  Schema.Undefined,
  Schema.Struct({
    type: Schema.Literal('webhook.permanent'),
    endpointUrl: Schema.String,
    eventType: Schema.String
  }),
  Schema.Struct({
    type: Schema.Literal('webhook.dead_letter'),
    endpointUrl: Schema.String,
    eventType: Schema.String,
    attempts: Schema.Number
  }),
  Schema.Struct({
    type: Schema.Literal('webhook.ladder_threshold'),
    target: Schema.String,
    consecutiveFailures: Schema.Number
  }),
  Schema.Struct({
    type: Schema.Literal('webhook.ladder_warning'),
    target: Schema.String,
    consecutiveFailures: Schema.Number,
    disableAt: Schema.Number
  }),
  Schema.Struct({
    type: Schema.Literal('account.impersonated'),
    adminName: Schema.String,
    minutes: Schema.Number
  }),
  Schema.Struct({
    type: Schema.Literal('workspace.export_ready'),
    workspaceName: Schema.String,
    expiresAt: Schema.String
  }),
  Schema.Struct({
    type: Schema.Literal('billing.plan_changed'),
    planName: Schema.String
  }),
  Schema.Struct({
    type: Schema.Literal('workspace_member.joined'),
    memberName: Schema.String,
    workspaceName: Schema.String,
    role: Schema.String
  }),
  Schema.Struct({
    type: Schema.Literal('api_token.created'),
    actorName: Schema.String,
    tokenName: Schema.String,
    scopes: Schema.String
  }),
  Schema.Struct({
    type: Schema.Literal('sso.test_failed'),
    protocol: Schema.String,
    domain: Schema.String,
    reasonCode: Schema.String
  }),
  SuspensionNotificationEvent
])

export const OptionalNotificationEvent = Schema.optionalKey(NotificationEvent)

export const NotificationRecord = Schema.Struct({
  id: Schema.String,
  kind: KindSchema,
  title: Schema.String,
  message: Schema.String,
  createdAt: Schema.String,
  read: Schema.Boolean,
  event: OptionalNotificationEvent
})

export const NotificationList = Schema.Array(NotificationRecord)

export const OverviewSchema = Schema.Struct({
  workspace: Schema.Struct({
    id: Schema.String,
    slug: Schema.String,
    name: Schema.String,
    planId: Schema.String
  }),
  notifications: NotificationList
})

export const LoadDemoShowcaseSchema = Schema.Struct({
  overview: OverviewSchema,
  memberCount: Schema.Number,
  notificationCount: Schema.Number,
  roleCount: Schema.Number,
  auditEventTypeCount: Schema.Number
})

export const OptionalDemoShowcase = Schema.Union([Schema.Null, LoadDemoShowcaseSchema])
