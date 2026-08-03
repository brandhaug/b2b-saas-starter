import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { buildWebHandler } from './http.ts'

let test: TestD1

const signCallback = async (timestamp: string, rawBody: string) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode('callback-secret'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`)
  )
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('')
}

beforeAll(async () => {
  test = await provisionTestD1()
}, 30_000)

afterAll(async () => test?.dispose())

describe('Transactional Email callback HTTP contract', () => {
  it('acknowledges an authenticated callback awaiting provider acceptance as pending', async () => {
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
    const rawBody = JSON.stringify({
      eventId: 'evt_http_pending',
      messageId: 'provider-http-pending',
      status: 'delivered',
      occurredAt: timestamp
    })
    const response = await built.handler(
      new Request('https://api.test/callbacks/email/transactional', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'webhook-signature': await signCallback(timestamp, rawBody),
          'webhook-timestamp': timestamp
        },
        body: rawBody
      })
    )
    await built.dispose()

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ outcome: 'pending' })
  })

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
