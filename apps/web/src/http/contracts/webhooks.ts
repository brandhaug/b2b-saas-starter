import { Schema } from 'effect'
import {
  CreateWebhookEndpointSchema,
  LoadWorkspaceWebhooksSchema,
  WebhookDeliveryAttempts
} from './webhook-records'

export const createWebhookEndpointServerFnResponse = CreateWebhookEndpointSchema
export const loadWorkspaceWebhooksServerFnResponse = LoadWorkspaceWebhooksSchema
export const updateWebhookEndpointServerFnResponse = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  enabled: Schema.Boolean,
  events: Schema.Array(Schema.String),
  successRate: Schema.Number
})
export const rotateWebhookSecretServerFnResponse = Schema.String
export const replayWebhookDeliveryServerFnResponse = Schema.Struct({
  deliveryId: Schema.String
})
export const sendTestEventServerFnResponse = Schema.Struct({
  deliveryId: Schema.String
})
export const listWebhookDeliveryAttemptsServerFnResponse = WebhookDeliveryAttempts
