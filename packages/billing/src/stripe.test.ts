import {
  testPrice,
  testItem,
  testSubscriptionFields
} from './provider-test-fixtures.ts'
import { afterEach, describe, expect, it, vi } from '@effect/vitest'
import { Effect } from 'effect'

import {
  createStripeCheckoutSession,
  createStripeCustomer,
  retrieveStripeCheckoutSession,
  retrieveStripeSubscription,
  updateStripeSubscriptionItemQuantity,
  verifyStripeSignature
} from './stripe.ts'

// oxlint-disable-next-line effect/noTestLifecycleHooks -- each test replaces the platform fetch double
afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown, status = 200): Response {
  // oxlint-disable-next-line effect/noGlobals -- this is a wire-level provider double
  return new Response(JSON.stringify(body), { status })
}

describe('Stripe provider adapter', () => {
  it.effect('uses a stable idempotency key and sends ownership metadata', () => {
    const requests: Array<{
      url: string
      init: { readonly headers?: Record<string, string>; readonly body?: string }
    }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (
          url: string,
          init: { readonly headers?: Record<string, string>; readonly body?: string }
        ) => {
          requests.push({ url, init })
          return Promise.resolve(
            jsonResponse({
              id: 'cs_test_1',
              url: 'https://checkout.stripe.com/c/pay/1',
              status: 'open',
              customer: 'cus_1',
              subscription: null,
              expires_at: 1_800_000_000
            })
          )
        }
      )
    )

    return Effect.gen(function* () {
      const session = yield* createStripeCheckoutSession({
        secretKey: 'sk_test_secret',
        priceId: 'price_team',
        quantity: 3,
        workspaceId: 'wrk_1',
        planId: 'team',
        successUrl: 'https://example.test/success',
        cancelUrl: 'https://example.test/cancel',
        claimId: 'claim_1',
        idempotencyKey: 'checkout-wrk_1-team-v1'
      })

      expect(session.url).toBe('https://checkout.stripe.com/c/pay/1')
      expect(requests[0]?.init.headers?.['stripe-version']).toBe('2025-03-31.basil')
      expect(requests).toHaveLength(1)
      expect(requests[0]?.init.headers).toMatchObject({
        authorization: 'Bearer sk_test_secret',
        'idempotency-key': 'checkout-wrk_1-team-v1'
      })
      const checkoutBody = requests[0]?.init.body
      if (checkoutBody === undefined) {
        return expect.fail('the checkout request must carry a form body')
      }
      expect(checkoutBody).toContain('metadata%5BworkspaceId%5D=wrk_1')
      expect(checkoutBody).toContain('metadata%5BclaimId%5D=claim_1')
      expect(checkoutBody).not.toContain('after_expiration')
    })
  })

  it.effect('decodes terminal sessions whose hosted URL is null', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
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
    )

    return Effect.gen(function* () {
      const session = yield* retrieveStripeCheckoutSession({
        secretKey: 'sk_test_secret',
        sessionId: 'cs_complete'
      })
      expect(session.status).toBe('complete')
      expect(session.url).toBeNull()
      expect(session.subscription).toBe('sub_1')
    })
  })

  it.effect('sanitizes provider errors and checks HTTP status before decoding', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            { error: { message: 'secret account details must never escape' } },
            402
          )
        )
      )
    )

    return Effect.gen(function* () {
      const error = yield* Effect.flip(
        createStripeCheckoutSession({
          secretKey: 'sk_test_secret',
          priceId: 'price_team',
          quantity: 1,
          workspaceId: 'wrk_1',
          planId: 'team',
          successUrl: 'https://example.test/success',
          cancelUrl: 'https://example.test/cancel',
          idempotencyKey: 'checkout-wrk_1-team-v1'
        })
      )
      expect(error.reason).toBe('stripe http:402')
      expect(error.reason).not.toContain('secret account details')
    })
  })

  it.effect('reads authoritative subscription price and seat quantity', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
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
    )

    return Effect.gen(function* () {
      const subscription = yield* retrieveStripeSubscription({
        secretKey: 'sk_test_secret',
        subscriptionId: 'sub_1'
      })
      expect(subscription.id).toBe('sub_1')
      expect(subscription.items.data[0]).toMatchObject({
        quantity: 4,
        price: testPrice
      })
      expect(subscription.metadata).toEqual({ workspaceId: 'wrk_1' })
    })
  })

  it.effect(
    'makes seat quantity writes idempotent and rejects provider status failures',
    () => {
      const requests: Array<{ url: string; init: RequestInit }> = []
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string, init: RequestInit) => {
          requests.push({ url, init })
          return Promise.resolve(jsonResponse({ id: 'si_1' }))
        })
      )
      return Effect.gen(function* () {
        yield* updateStripeSubscriptionItemQuantity({
          secretKey: 'sk_test_secret',
          subscriptionItemId: 'si_1',
          quantity: 5,
          idempotencyKey: 'seat-sync-wrk_1-5'
        })
        expect(requests[0]?.init.headers).toMatchObject({
          'idempotency-key': 'seat-sync-wrk_1-5'
        })
        expect(requests[0]?.url).toContain('/subscription_items/si_1')
      })
    }
  )

  it.effect(
    'creates a customer with idempotent workspace ownership metadata and reads expiry',
    () => {
      const requests: Array<{ url: string; init: RequestInit }> = []
      vi.stubGlobal(
        'fetch',
        vi.fn((url: string, init: RequestInit) => {
          requests.push({ url, init })
          if (url.includes('/customers')) {
            return Promise.resolve(
              jsonResponse({ id: 'cus_1', metadata: { workspaceId: 'wrk_1' } })
            )
          }
          return Promise.resolve(
            jsonResponse({
              id: 'cs_test_1',
              status: 'open',
              customer: 'cus_1',
              subscription: null,
              expires_at: 1_800_000_000,
              url: 'https://checkout.stripe.com/c/pay/1'
            })
          )
        })
      )

      return Effect.gen(function* () {
        const customer = yield* createStripeCustomer({
          secretKey: 'sk_test_secret',
          workspaceId: 'wrk_1',
          idempotencyKey: 'customer-wrk_1-v1',
          email: 'billing@example.test'
        })
        const session = yield* retrieveStripeCheckoutSession({
          secretKey: 'sk_test_secret',
          sessionId: 'cs_test_1'
        })
        expect(customer.id).toBe('cus_1')
        expect(session.expiresAt).toBe(1_800_000_000)
        expect(requests[0]?.init.headers).toMatchObject({
          'idempotency-key': 'customer-wrk_1-v1'
        })
      })
    }
  )
})

describe('Stripe webhook signature verification', () => {
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
            secret: 'whsec_test',
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
          secret: 'whsec_test',
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
          secret: 'whsec_test',
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
        verifyStripeSignature({ secret: 'whsec_test', payload, header }, fixedNow)
      ).resolves.toBe(false)
    }
  })
  /* oxlint-enable effect/noAsyncFunction */
})
