import { describe, expect, it } from '@effect/vitest'
import { Schema } from 'effect'
import { ApiTokenId, WebhookDeliveryId, WebhookEndpointId } from './ids.ts'

describe('resource identity boundaries', () => {
  it('rejects empty input and preserves wire strings', () => {
    for (const schema of [ApiTokenId, WebhookEndpointId, WebhookDeliveryId]) {
      expect(Schema.is(schema)('')).toBe(false)
      expect(Schema.decodeUnknownSync(schema)('resource-id')).toBe('resource-id')
      expect(Schema.encodeSync(schema)(schema.make('resource-id'))).toBe('resource-id')
    }
  })

  it('keeps resource kinds distinct in TypeScript', () => {
    const endpoint = WebhookEndpointId.make('wh_example')
    const delivery = WebhookDeliveryId.make('whd_example')
    const token = ApiTokenId.make('tok_example')
    // @ts-expect-error An endpoint cannot authorize a token operation.
    const wrongToken: ApiTokenId = endpoint
    // @ts-expect-error An endpoint cannot identify a delivery to replay.
    const wrongDelivery: WebhookDeliveryId = endpoint
    // @ts-expect-error A delivery cannot identify its destination.
    const wrongEndpoint: WebhookEndpointId = delivery
    expect([wrongToken, wrongDelivery, wrongEndpoint, token]).toHaveLength(4)
  })
})
