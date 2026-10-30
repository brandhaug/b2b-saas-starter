import { Schema } from 'effect'

export const ListWebhookDeliveryAttemptsSchema = Schema.Struct({
  id: Schema.String,
  deliveryId: Schema.String,
  attempts: Schema.Number,
  phase: Schema.Union([Schema.Literal('http'), Schema.Literal('terminal')]),
  status: Schema.String,
  attemptedAt: Schema.String,
  durationMs: Schema.Union([Schema.Null, Schema.Number]),
  failureReason: Schema.Union([Schema.Null, Schema.String]),
  responseStatus: Schema.Union([Schema.Null, Schema.Number]),
  requestHeaders: Schema.Union([
    Schema.Null,
    Schema.Record(Schema.String, Schema.String)
  ]),
  responseBody: Schema.Union([Schema.Null, Schema.String])
})

export const WebhookDeliveryAttempts = Schema.Array(ListWebhookDeliveryAttemptsSchema)

export const WebhookDeliveryRecord = Schema.Struct({
  id: Schema.String,
  endpointId: Schema.String,
  eventType: Schema.String,
  status: Schema.String,
  attempts: Schema.Number,
  lastAttemptAt: Schema.Union([Schema.Null, Schema.String]),
  nextAttemptAt: Schema.Union([Schema.Null, Schema.String]),
  responseStatus: Schema.Union([Schema.Null, Schema.Number]),
  payload: Schema.Json,
  requestHeaders: Schema.Union([
    Schema.Null,
    Schema.Record(Schema.String, Schema.String)
  ]),
  responseBody: Schema.Union([Schema.Null, Schema.String]),
  replayedFrom: Schema.Union([Schema.Null, Schema.String])
})

export const WebhookDeliveryRecords = Schema.Array(WebhookDeliveryRecord)

export const WebhookEndpointWithDeliveries = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  enabled: Schema.Boolean,
  events: Schema.Array(Schema.String),
  successRate: Schema.Number,
  deliveries: WebhookDeliveryRecords
})

export const WebhookEndpointsWithDeliveries = Schema.Array(
  WebhookEndpointWithDeliveries
)

export const LoadWorkspaceWebhooksSchema = Schema.Struct({
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
  unreadCount: Schema.Number,
  endpoints: WebhookEndpointsWithDeliveries
})

export const CreateWebhookEndpointSchema = Schema.Struct({
  endpoint: Schema.Struct({
    id: Schema.String,
    url: Schema.String,
    enabled: Schema.Boolean,
    events: Schema.Array(Schema.String),
    successRate: Schema.Number
  }),
  signingSecret: Schema.String
})
