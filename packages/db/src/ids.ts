import { Schema } from 'effect'

/** Opaque resource identities stay strings on the wire and distinct in application code. */
export const ApiTokenId = Schema.NonEmptyString.pipe(Schema.brand('ApiTokenId'))
export type ApiTokenId = typeof ApiTokenId.Type

export const WebhookEndpointId = Schema.NonEmptyString.pipe(
  Schema.brand('WebhookEndpointId')
)
export type WebhookEndpointId = typeof WebhookEndpointId.Type

export const WebhookDeliveryId = Schema.NonEmptyString.pipe(
  Schema.brand('WebhookDeliveryId')
)
export type WebhookDeliveryId = typeof WebhookDeliveryId.Type
