import { WebhookDeliveryId } from '@b2b-saas-starter/db/ids'
import { activeSigningSecrets } from '@b2b-saas-starter/capabilities/developer-platform/webhook-delivery-plan'
import { randomWebhookSecret } from '@b2b-saas-starter/capabilities/crypto'
import { describe, expect, it, vi } from '@effect/vitest'
import { DateTime, Effect, Result } from 'effect'
import { Webhook } from 'standardwebhooks'
import { computeWebhookSignature, signatureHeaderValue } from './webhook-signing.ts'

const currentSecret = 'whsec_MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='
const previousSecret = 'whsec_YWJjZGVmMDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODk='
const messageId = WebhookDeliveryId.make('whd_interoperability')
const decodedBody = { deliveryId: messageId, payload: { text: 'héllo 🌍' } }
const body = '{"deliveryId":"whd_interoperability","payload":{"text":"héllo 🌍"}}'

const signedHeaders = Effect.fn('Test.signedHeaders')(function* (
  secrets: ReadonlyArray<string>,
  timestamp: number
) {
  const signatures = yield* Effect.forEach(secrets, (secret) =>
    computeWebhookSignature(secret, messageId, timestamp, body)
  )
  return {
    'webhook-id': messageId,
    'webhook-timestamp': String(timestamp),
    'webhook-signature': signatureHeaderValue(signatures)
  }
})

describe('Standard Webhooks reference verifier interoperability', () => {
  // Failure modes: UTF-8/body/identity/timestamp drift, double version prefixes,
  // reversed rotation keys, or malformed secrets escaping as defects.
  it.effect('matches a fixed HMAC vector and keeps current-key-first headers', () =>
    Effect.gen(function* () {
      const current = yield* computeWebhookSignature(
        currentSecret,
        messageId,
        1_700_000_000,
        body
      )
      const previous = yield* computeWebhookSignature(
        previousSecret,
        messageId,
        1_700_000_000,
        body
      )
      expect(current).toBe('v1,B+5UtzyHA35rTG8GXVw5cibhrX7uk81/MvcTch6gDOE=')
      expect(signatureHeaderValue([current, previous])).toBe(`${current} ${previous}`)
    })
  )

  it.effect('reports invalid secrets as typed availability failures', () =>
    Effect.gen(function* () {
      for (const secret of ['whsec_', 'whsec_!!!!']) {
        const result = yield* Effect.result(
          computeWebhookSignature(secret, messageId, 1_700_000_000, body)
        )
        expect(Result.isFailure(result)).toBe(true)
        if (Result.isFailure(result)) {
          expect(result.failure._tag).toBe('CapabilityUnavailable')
        }
      }
    })
  )

  it.effect(
    'verifies exact UTF-8 bytes and rejects changed body, identity, and stale time',
    () =>
      Effect.gen(function* () {
        const now = yield* DateTime.now
        // Match TestClock because the independent verifier reads Date.now().
        yield* Effect.acquireRelease(
          Effect.sync(() =>
            vi.spyOn(Date, 'now').mockReturnValue(DateTime.toEpochMillis(now))
          ),
          (clock) => Effect.sync(() => clock.mockRestore())
        )
        const timestamp = Math.floor(DateTime.toEpochMillis(now) / 1000)
        const headers = yield* signedHeaders([currentSecret], timestamp)
        const verifier = new Webhook(currentSecret)
        expect(verifier.verify(body, headers)).toEqual(decodedBody)
        expect(() => verifier.verify(`${body} `, headers)).toThrow(
          'No matching signature found'
        )
        expect(() =>
          verifier.verify(body, { ...headers, 'webhook-id': 'different' })
        ).toThrow('No matching signature found')
        const stale = yield* signedHeaders([currentSecret], timestamp - 301)
        expect(() => verifier.verify(body, stale)).toThrow('Message timestamp too old')
        const future = yield* signedHeaders([currentSecret], timestamp + 301)
        expect(() => verifier.verify(body, future)).toThrow('Message timestamp too new')
      })
  )

  it.live(
    'both receivers verify during overlap; the old receiver fails at expiry',
    () =>
      Effect.gen(function* () {
        const now = yield* DateTime.now
        const timestamp = Math.floor(DateTime.toEpochMillis(now) / 1000)
        const endpoint = {
          signingSecret: currentSecret,
          previousSigningSecret: previousSecret,
          previousSecretExpiresAt: DateTime.formatIso(DateTime.add(now, { seconds: 1 }))
        }
        const overlapping = yield* signedHeaders(
          activeSigningSecrets(endpoint, now),
          timestamp
        )
        expect(new Webhook(currentSecret).verify(body, overlapping)).toEqual(
          decodedBody
        )
        expect(new Webhook(previousSecret).verify(body, overlapping)).toEqual(
          decodedBody
        )
        const expired = yield* signedHeaders(
          activeSigningSecrets(endpoint, DateTime.add(now, { seconds: 1 })),
          timestamp
        )
        expect(new Webhook(currentSecret).verify(body, expired)).toEqual(decodedBody)
        expect(() => new Webhook(previousSecret).verify(body, expired)).toThrow(
          'No matching signature found'
        )
      })
  )

  it.live(
    'generated keys are 256-bit base64 keys accepted by the reference verifier',
    () =>
      Effect.gen(function* () {
        const secret = randomWebhookSecret()
        expect(secret).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/)
        const timestamp = Math.floor(DateTime.toEpochMillis(yield* DateTime.now) / 1000)
        expect(
          new Webhook(secret).verify(body, yield* signedHeaders([secret], timestamp))
        ).toEqual(decodedBody)
      })
  )
})
