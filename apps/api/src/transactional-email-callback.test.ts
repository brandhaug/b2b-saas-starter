import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { buildWebHandler } from './http.ts'

let test: TestD1

beforeAll(async () => {
  test = await provisionTestD1()
}, 30_000)

afterAll(async () => test?.dispose())

describe('Transactional Email callback HTTP contract', () => {
  it('rejects an invalid signature instead of acknowledging it', async () => {
    const built = buildWebHandler({
      DB: test.d1,
      EMAIL: {
        send: async () => ({
          messageId: 'unused',
          acceptedAt: new Date().toISOString()
        })
      },
      CLOUDFLARE_EMAIL_FROM: 'booking@beesolo.example',
      TRANSACTIONAL_EMAIL_SENDER_VERIFIED: 'true',
      TRANSACTIONAL_EMAIL_CALLBACK_SECRET: 'callback-secret',
      TRANSACTIONAL_EMAIL_PROVIDER_REFERENCE_FINGERPRINT_KEY: 'provider-reference-key'
    })
    const timestamp = new Date().toISOString()
    const response = await built.handler(
      new Request('https://api.test/callbacks/email/transactional', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'webhook-signature': 'invalid',
          'webhook-timestamp': timestamp
        },
        body: JSON.stringify({
          eventId: 'evt_invalid',
          messageId: 'provider-one',
          status: 'delivered',
          occurredAt: timestamp
        })
      })
    )
    await built.dispose()

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      _tag: 'TransactionalEmailCallbackInvalid',
      code: 'invalid_signature'
    })
  })
})
