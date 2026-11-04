import { nominal } from 'effect/Brand'
import {
  type ApiTokenId,
  type WebhookEndpointId,
  type WebhookDeliveryId
} from './ids.ts'

/** Trusted fixture values only. Untrusted inputs must use the identity schemas. */
export const apiTokenId = nominal<ApiTokenId>()
export const webhookEndpointId = nominal<WebhookEndpointId>()
export const webhookDeliveryId = nominal<WebhookDeliveryId>()
