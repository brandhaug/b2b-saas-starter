import { Schema } from 'effect'
import { AuditEventRecords } from './administration-records'
import { NotificationList } from './notification-records'

export const OptionalWebhookEndpoints = Schema.Union([
  Schema.Null,
  Schema.Array(
    Schema.Struct({
      id: Schema.String,
      url: Schema.String,
      enabled: Schema.Boolean,
      events: Schema.Array(Schema.String),
      successRate: Schema.Number
    })
  )
])

export const ApiTokenRecord = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  prefix: Schema.String,
  scopes: Schema.Array(
    Schema.Union([
      Schema.Literal('read'),
      Schema.Literal('admin'),
      Schema.Literal('write')
    ])
  ),
  lastUsedAt: Schema.Union([Schema.Null, Schema.String]),
  createdAt: Schema.String,
  expiresAt: Schema.Union([Schema.Null, Schema.String]),
  replacedByTokenId: Schema.Union([Schema.Null, Schema.String])
})

export const ApiTokenRecords = Schema.Array(ApiTokenRecord)

export const OptionalApiTokens = Schema.Union([Schema.Null, ApiTokenRecords])

export const InvitationRecord = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  role: Schema.Union([
    Schema.Literal('owner'),
    Schema.Literal('admin'),
    Schema.Literal('member')
  ]),
  status: Schema.Union([
    Schema.Literal('pending'),
    Schema.Literal('accepted'),
    Schema.Literal('rejected'),
    Schema.Literal('canceled')
  ]),
  expiresAt: Schema.String
})

export const InvitationRecords = Schema.Array(InvitationRecord)

export const OptionalInvitations = Schema.Union([Schema.Null, InvitationRecords])

export const OptionalAuditEvents = Schema.Union([Schema.Null, AuditEventRecords])

export const OnboardingStepId = Schema.Union([
  Schema.Literal('invite_member'),
  Schema.Literal('create_api_token'),
  Schema.Literal('add_webhook_endpoint'),
  Schema.Literal('enable_two_factor'),
  Schema.Literal('choose_plan')
])

export const OnboardingStep = Schema.Struct({
  id: OnboardingStepId,
  complete: Schema.Boolean
})

export const OnboardingSteps = Schema.Array(OnboardingStep)

export const ProgressSchema = Schema.Struct({
  steps: OnboardingSteps,
  completedCount: Schema.Number,
  totalCount: Schema.Number,
  dismissedAt: Schema.Union([Schema.Null, Schema.String])
})

export const LoadWorkspaceDashboardSchema = Schema.Struct({
  workspace: Schema.Struct({
    id: Schema.String,
    slug: Schema.String,
    name: Schema.String,
    planId: Schema.String
  }),
  notifications: NotificationList,
  unreadCount: Schema.Number,
  viewer: Schema.Union([
    Schema.Null,
    Schema.Struct({
      role: Schema.Union([
        Schema.Literal('owner'),
        Schema.Literal('admin'),
        Schema.Literal('member')
      ])
    })
  ]),
  webhooks: OptionalWebhookEndpoints,
  apiTokens: OptionalApiTokens,
  invitations: OptionalInvitations,
  auditEvents: OptionalAuditEvents,
  progress: ProgressSchema
})
