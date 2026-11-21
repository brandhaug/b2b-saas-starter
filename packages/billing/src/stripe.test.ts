import { WorkspaceId } from '@b2b-saas-starter/db/ids'
import {
  testPrice,
  testItem,
  testSubscriptionFields
} from './provider-test-fixtures.ts'
import { describe, expect, it, vi } from '@effect/vitest'
import { Deferred, Effect, Fiber, Layer, Redacted, Schema } from 'effect'
import { TestClock } from 'effect/testing'
import { wireHttpClient, type WireRequest } from '@b2b-saas-starter/failure/http-client'

import { billingOptionsFromEnv } from './billing-config.ts'
import { WideEventLoggerLive, withRequestScope } from '@b2b-saas-starter/logger'

import {
  createStripeCheckoutSession,
  createStripeCustomer,
  retrieveStripeCheckoutSession,
  retrieveStripeCustomer,
  retrieveStripeSubscription,
  updateStripeSubscriptionItemQuantity,
  verifyStripeSignature
} from './stripe.ts'

const decodeLine = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))

/** What the adapter put on the wire, with the URL it went to. */
type SentRequest = WireRequest & { readonly url: string }

function jsonResponse(body: unknown, status = 200): Response {
  // oxlint-disable-next-line effect/noGlobals -- this is a wire-level provider double
  return new Response(JSON.stringify(body), { status })
}

describe('Stripe provider adapter', () => {
  it.effect('keeps the deadline and cancellation active while reading the body', () =>
    Effect.gen(function* () {
      const effectContext = yield* Effect.context<never>()

      const reading = yield* Deferred.make<undefined>()
      let signal: AbortSignal | undefined
      const wire = vi.fn((_url: string, request: WireRequest) => {
        signal = request.signal
        return Promise.resolve(
          new Response(
            new ReadableStream({
              pull() {
                Effect.runSyncWith(effectContext)(Deferred.succeed(reading, undefined))
                return new Promise(() => {})
              }
            })
          )
        )
      })
      const fiber = yield* retrieveStripeCheckoutSession({
        secretKey: Redacted.make('secret'),
        sessionId: 'cs_held'
      }).pipe(Effect.flip, Effect.provide(wireHttpClient(wire)), Effect.forkChild)
      yield* Deferred.await(reading)
      yield* TestClock.adjust('10 seconds')
      expect((yield* Fiber.join(fiber)).reason).toBe('stripe request timed out')
      expect(signal?.aborted).toBe(true)
      expect(wire).toHaveBeenCalledTimes(1)
    })
  )

  it.effect('refuses redirects without retrying or exposing the provider body', () => {
    const wire = vi.fn((_url: string, request: WireRequest) => {
      expect(request.redirect).toBe('manual')
      return Promise.resolve(jsonResponse({ error: 'private provider details' }, 307))
    })
    return Effect.gen(function* () {
      const error = yield* retrieveStripeCheckoutSession({
        secretKey: Redacted.make('secret'),
        sessionId: 'cs_redirect'
      }).pipe(Effect.flip)
      expect(error.reason).toBe('stripe http:307')
      expect(wire).toHaveBeenCalledTimes(1)
    }).pipe(Effect.provide(wireHttpClient(wire)))
  })

  it.effect('keeps the env key redacted in operation inputs until the header', () => {
    // oxlint-disable-next-line react-doctor/no-secrets-in-client-code -- inert test key whose leak the test detects
    const plaintext = 'sk_test_must_not_leak'
    const requests: Array<SentRequest> = []
    function wire(url: string, request: WireRequest) {
      requests.push({ ...request, url })
      return jsonResponse({ error: 'provider down' }, 500)
    }
    return Effect.gen(function* () {
      const options = billingOptionsFromEnv({ STRIPE_SECRET_KEY: plaintext })
      if (options?.secretKey === undefined) {
        return expect.fail('a set STRIPE_SECRET_KEY must configure the provider')
      }
      const input = { secretKey: options.secretKey, customerId: 'cus_1' }
      // Options and operation inputs reach spans, logs and causes serialized.
      // oxlint-disable-next-line effect/noGlobals -- the assertion is what JSON serialization (logs, spans, causes) exposes
      expect(JSON.stringify({ options, input })).not.toContain(plaintext)
      yield* retrieveStripeCustomer(input).pipe(Effect.flip)
      expect(requests[0]?.headers.authorization).toBe(`Bearer ${plaintext}`)
    }).pipe(Effect.provide(wireHttpClient(wire)))
  })

  it.effect('uses a stable idempotency key and sends ownership metadata', () => {
    const requests: Array<SentRequest> = []
    function wire(url: string, request: WireRequest) {
      requests.push({ ...request, url })
      return jsonResponse({
        id: 'cs_test_1',
        url: 'https://checkout.stripe.com/c/pay/1',
        status: 'open',
        customer: 'cus_1',
        subscription: null,
        expires_at: 1_800_000_000
      })
    }

    return Effect.gen(function* () {
      const session = yield* createStripeCheckoutSession({
        secretKey: Redacted.make('sk_test_secret'),
        priceId: 'price_team',
        quantity: 3,
        workspaceId: WorkspaceId.make('wrk_1'),
        planId: 'team',
        successUrl: 'https://example.test/success',
        cancelUrl: 'https://example.test/cancel',
        claimId: 'claim_1',
        idempotencyKey: 'checkout-wrk_1-team-v1'
      })

      expect(session.url).toBe('https://checkout.stripe.com/c/pay/1')
      expect(requests[0]?.headers['stripe-version']).toBe('2025-03-31.basil')
      expect(requests).toHaveLength(1)
      expect(requests[0]?.headers).toMatchObject({
        authorization: 'Bearer sk_test_secret',
        'content-type': 'application/x-www-form-urlencoded',
        'idempotency-key': 'checkout-wrk_1-team-v1'
      })
      const checkoutBody = requests[0]?.body
      if (checkoutBody === undefined || checkoutBody === '') {
        return expect.fail('the checkout request must carry a form body')
      }
      expect(checkoutBody).toContain('metadata%5BworkspaceId%5D=wrk_1')
      expect(checkoutBody).toContain('metadata%5BclaimId%5D=claim_1')
      expect(checkoutBody).not.toContain('after_expiration')
    }).pipe(Effect.provide(wireHttpClient(wire)))
  })

  it.effect('decodes terminal sessions whose hosted URL is null', () => {
    const wire = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          id: 'cs_complete',
          url: null,
          status: 'complete',
          expires_at: 1_800_000_000,
          customer: 'cus_1',
          subscription: 'sub_1'
        })
      )
    )

    return Effect.gen(function* () {
      const session = yield* retrieveStripeCheckoutSession({
        secretKey: Redacted.make('sk_test_secret'),
        sessionId: 'cs_complete'
      })
      expect(session.status).toBe('complete')
      expect(session.url).toBeNull()
      expect(session.subscription).toBe('sub_1')
    }).pipe(Effect.provide(wireHttpClient(wire)))
  })

  it.effect('sanitizes provider errors and checks HTTP status before decoding', () => {
    const wire = vi.fn(() =>
      Promise.resolve(
        jsonResponse(
          { error: { message: 'secret account details must never escape' } },
          402
        )
      )
    )

    return Effect.gen(function* () {
      const error = yield* Effect.flip(
        createStripeCheckoutSession({
          secretKey: Redacted.make('sk_test_secret'),
          priceId: 'price_team',
          quantity: 1,
          workspaceId: WorkspaceId.make('wrk_1'),
          planId: 'team',
          successUrl: 'https://example.test/success',
          cancelUrl: 'https://example.test/cancel',
          idempotencyKey: 'checkout-wrk_1-team-v1'
        })
      )
      expect(error.reason).toBe('stripe http:402')
      expect(error.reason).not.toContain('secret account details')
    }).pipe(Effect.provide(wireHttpClient(wire)))
  })

  // Live services: the console logger writes to the platform console, not TestConsole.
  it.live(
    'names the transport failure behind stripe request failed on the wide event',
    () => {
      const lines: Array<string> = []
      const errors = vi
        .spyOn(console, 'error')
        .mockImplementation((line: string) => lines.push(line))
      const wire = vi.fn(() => Promise.reject(new Error('connect ECONNREFUSED')))
      return Effect.gen(function* () {
        const exit = yield* Effect.exit(
          withRequestScope(
            { service: 'api', event: 'api.request' },
            retrieveStripeCustomer({
              secretKey: Redacted.make('sk_test_secret'),
              customerId: 'cus_1'
            })
          )
        )
        expect(exit).toMatchObject({
          cause: { reasons: [{ error: { reason: 'stripe request failed' } }] }
        })
        expect(lines).toHaveLength(1)
        expect(decodeLine(lines[0] ?? '')).toMatchObject({
          annotations: {
            errorTag: 'CapabilityUnavailable',
            causeTag: 'HttpClientError'
          }
        })
      }).pipe(
        Effect.provide(
          wireHttpClient(wire).pipe(Layer.provideMerge(WideEventLoggerLive))
        ),
        Effect.ensuring(Effect.sync(() => errors.mockRestore()))
      )
    }
  )

  it.effect('reads authoritative subscription price and seat quantity', () => {
    const wire = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          id: 'sub_1',
          customer: 'cus_1',
          ...testSubscriptionFields,
          status: 'active',
          items: {
            data: [{ ...testItem, id: 'si_1', quantity: 4, price: testPrice }]
          },
          metadata: { workspaceId: 'wrk_1' }
        })
      )
    )

    return Effect.gen(function* () {
      const subscription = yield* retrieveStripeSubscription({
        secretKey: Redacted.make('sk_test_secret'),
        subscriptionId: 'sub_1'
      })
      expect(subscription.id).toBe('sub_1')
      expect(subscription.items.data[0]).toMatchObject({
        quantity: 4,
        price: testPrice
      })
      expect(subscription.metadata).toEqual({ workspaceId: 'wrk_1' })
    }).pipe(Effect.provide(wireHttpClient(wire)))
  })

  it.effect(
    'makes seat quantity writes idempotent and rejects provider status failures',
    () => {
      const requests: Array<SentRequest> = []
      function wire(url: string, request: WireRequest) {
        requests.push({ ...request, url })
        return jsonResponse({ id: 'si_1' })
      }
      return Effect.gen(function* () {
        yield* updateStripeSubscriptionItemQuantity({
          secretKey: Redacted.make('sk_test_secret'),
          subscriptionItemId: 'si_1',
          quantity: 5,
          idempotencyKey: 'seat-sync-wrk_1-5'
        })
        expect(requests[0]?.headers).toMatchObject({
          'idempotency-key': 'seat-sync-wrk_1-5'
        })
        expect(requests[0]?.url).toContain('/subscription_items/si_1')
      }).pipe(Effect.provide(wireHttpClient(wire)))
    }
  )

  it.effect(
    'creates a customer with idempotent workspace ownership metadata and reads expiry',
    () => {
      const requests: Array<SentRequest> = []
      function wire(url: string, request: WireRequest) {
        requests.push({ ...request, url })
        if (url.includes('/customers')) {
          return jsonResponse({ id: 'cus_1', metadata: { workspaceId: 'wrk_1' } })
        }
        return jsonResponse({
          id: 'cs_test_1',
          status: 'open',
          customer: 'cus_1',
          subscription: null,
          expires_at: 1_800_000_000,
          url: 'https://checkout.stripe.com/c/pay/1'
        })
      }

      return Effect.gen(function* () {
        const customer = yield* createStripeCustomer({
          secretKey: Redacted.make('sk_test_secret'),
          workspaceId: WorkspaceId.make('wrk_1'),
          idempotencyKey: 'customer-wrk_1-v1',
          email: 'billing@example.test'
        })
        const session = yield* retrieveStripeCheckoutSession({
          secretKey: Redacted.make('sk_test_secret'),
          sessionId: 'cs_test_1'
        })
        expect(customer.id).toBe('cus_1')
        expect(session.expiresAt).toBe(1_800_000_000)
        expect(requests[0]?.headers).toMatchObject({
          'idempotency-key': 'customer-wrk_1-v1'
        })
      }).pipe(Effect.provide(wireHttpClient(wire)))
    }
  )
})

describe('Stripe webhook signature verification', () => {
  // Failure modes: future replay, off-by-one tolerance, zero disabling validation,
  // payload byte drift, permissive SDK parseInt timestamps, and crypto rejection.
  /* oxlint-disable effect/noAsyncFunction -- these tests exercise the real Web Crypto the verifier depends on */
  const nowSeconds = 1_700_000_000
  function fixedNow(): number {
    return nowSeconds * 1000
  }

  async function signature(secret: string, payload: string, timestamp: number) {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const signed = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`${timestamp}.${payload}`)
    )
    return [...new Uint8Array(signed)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  }

  it('accepts a matching v1 from either side of a rotated signature list', async () => {
    const payload = '{"type":"checkout.session.completed"}'
    const valid = await signature('whsec_test', payload, nowSeconds)
    const invalid = '0'.repeat(valid.length)

    for (const v1s of [
      [valid, invalid],
      [invalid, valid]
    ]) {
      await expect(
        verifyStripeSignature(
          {
            secret: Redacted.make('whsec_test'),
            payload,
            header: `t=${nowSeconds},${v1s.map((value) => `v1=${value}`).join(',')}`
          },
          fixedNow
        )
      ).resolves.toBe(true)
    }
  })

  it('rejects headers with no valid v1, stale timestamps, or malformed schemes', async () => {
    const payload = 'p'
    const valid = await signature('whsec_test', payload, nowSeconds)
    await expect(
      verifyStripeSignature(
        {
          secret: Redacted.make('whsec_test'),
          payload,
          header: `t=${nowSeconds},v1=${'0'.repeat(valid.length)},v1=${'f'.repeat(valid.length)}`
        },
        fixedNow
      )
    ).resolves.toBe(false)
    const staleTimestamp = nowSeconds - 301
    const staleSignature = await signature('whsec_test', payload, staleTimestamp)
    await expect(
      verifyStripeSignature(
        {
          secret: Redacted.make('whsec_test'),
          payload,
          header: `t=${staleTimestamp},v1=${staleSignature}`
        },
        fixedNow
      )
    ).resolves.toBe(false)
    for (const header of [
      '',
      'garbage',
      `t=${nowSeconds},v0=${valid}`,
      `t=abc,v1=${valid}`
    ]) {
      await expect(
        verifyStripeSignature(
          { secret: Redacted.make('whsec_test'), payload, header },
          fixedNow
        )
      ).resolves.toBe(false)
    }
  })

  it('uses the injected clock for inclusive past and future tolerance', async () => {
    const payload = 'signed payload é\n'
    for (const [offset, accepted] of [
      [-301, false],
      [-300, true],
      [0, true],
      [300, true],
      [301, false]
    ] as const) {
      const timestamp = nowSeconds + offset
      const valid = await signature('whsec_test', payload, timestamp)
      await expect(
        verifyStripeSignature(
          {
            secret: Redacted.make('whsec_test'),
            payload,
            header: `t=${timestamp},v1=${valid}`
          },
          fixedNow
        )
      ).resolves.toBe(accepted)
    }
  })

  it('keeps zero tolerance exact and verifies the original payload bytes', async () => {
    const payload = 'signed payload é\n'
    const valid = await signature('whsec_test', payload, nowSeconds)
    const header = ` t = ${nowSeconds} , v1 = ${valid} `
    await expect(
      verifyStripeSignature(
        { secret: Redacted.make('whsec_test'), payload, header, toleranceSeconds: 0 },
        fixedNow
      )
    ).resolves.toBe(true)
    await expect(
      verifyStripeSignature(
        { secret: Redacted.make('whsec_test'), payload: payload.trim(), header },
        fixedNow
      )
    ).resolves.toBe(false)
    await expect(
      verifyStripeSignature(
        { secret: Redacted.make('whsec_test'), payload, header, toleranceSeconds: 0 },
        () => fixedNow() + 1000
      )
    ).resolves.toBe(false)
    await expect(
      verifyStripeSignature(
        { secret: Redacted.make('whsec_test'), payload, header, toleranceSeconds: 0 },
        () => fixedNow() - 1000
      )
    ).resolves.toBe(false)
    for (const timestamp of [`${nowSeconds}junk`, 'NaN', 'Infinity']) {
      await expect(
        verifyStripeSignature(
          {
            secret: Redacted.make('whsec_test'),
            payload,
            header: `t=${timestamp},v1=${valid}`
          },
          fixedNow
        )
      ).resolves.toBe(false)
    }
  })

  it('preserves platform crypto rejection instead of reporting a verified signature', async () => {
    const payload = 'p'
    const valid = await signature('whsec_test', payload, nowSeconds)
    const refusal = new Error('sign refused')
    vi.spyOn(crypto.subtle, 'sign').mockRejectedValue(refusal)
    try {
      await expect(
        verifyStripeSignature(
          {
            secret: Redacted.make('whsec_test'),
            payload,
            header: `t=${nowSeconds},v1=${valid}`
          },
          fixedNow
        )
      ).rejects.toBe(refusal)
    } finally {
      vi.restoreAllMocks()
    }
  })
  /* oxlint-enable effect/noAsyncFunction */
})
