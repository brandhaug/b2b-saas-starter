import { billingProviderEvents } from '@b2b-saas-starter/db/schema'
import { Database } from '@b2b-saas-starter/db/service'
import { type SeatSyncQueueBinding } from '@b2b-saas-starter/billing/seat-sync'
import { Effect } from 'effect'
import { eq } from 'drizzle-orm'
import { expect, layer } from '@effect/vitest'
import { vi } from 'vite-plus/test'

import {
  LIVE_SUITE_TIMEOUT,
  TestD1,
  TestDatabase
} from '@b2b-saas-starter/capabilities/testing/live-harness'
import { type Env } from './queue-consumer.ts'
import { handleStripeRequest } from './stripe-endpoint.ts'

const webhookSecret = 'whsec_live_ingress_test'
// oxlint-disable-next-line effect/noGlobals -- fixed provider fixture is the independent raw-body test vector
const payload = JSON.stringify({
  id: 'evt_live_ingress',
  created: 1_790_000_000,
  type: 'customer.subscription.created',
  data: {
    object: {
      id: 'sub_live_ingress',
      customer: 'cus_live_ingress',
      metadata: { workspaceId: 'wrk_live' },
      items: { data: [{ id: 'si_live_ingress', quantity: 3 }] }
    }
  }
})

// oxlint-disable-next-line effect/noAsyncFunction -- Web Crypto is promise-based at this test boundary
async function signedHeader(body: string): Promise<string> {
  // oxlint-disable-next-line effect/noGlobals -- current wall time keeps the fixture inside Stripe's replay window
  const timestamp = Math.floor(Date.now() / 1000).toString()
  // oxlint-disable-next-line effect/noAsyncFunction -- Web Crypto key import is promise-based
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(webhookSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = new Uint8Array(
    // oxlint-disable-next-line effect/noAsyncFunction -- Web Crypto signing is promise-based
    await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`${timestamp}.${body}`)
    )
  )
  const hex = Array.from(signature, (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  )
  return `t=${timestamp},v1=${hex}`
}

function queueBinding() {
  return {
    send: vi.fn((_message: unknown) => Promise.resolve(undefined))
  } satisfies SeatSyncQueueBinding
}

function configuredEnv(d1: D1Database, queue: SeatSyncQueueBinding): Env {
  return {
    DB: d1,
    BILLING_QUEUE: queue,
    STRIPE_SECRET_KEY: 'sk_test_live_ingress',
    STRIPE_PRICE_ID_TEAM: 'price_team_live_ingress',
    STRIPE_WEBHOOK_SECRET: webhookSecret
  }
}

function missingEnv(
  d1: D1Database,
  field:
    | 'DB'
    | 'STRIPE_SECRET_KEY'
    | 'STRIPE_PRICE_ID_TEAM'
    | 'STRIPE_WEBHOOK_SECRET'
    | 'BILLING_QUEUE'
) {
  const queue = queueBinding()
  const env = configuredEnv(d1, queue)
  Object.defineProperty(env, field, { value: undefined, writable: true })
  return { queue, env }
}

function request(header: string | null): Request {
  const init: RequestInit = {
    method: 'POST',
    body: payload
  }
  if (header !== null) {
    init.headers = { 'stripe-signature': header }
  }
  return new Request('https://worker.test/webhooks/stripe', init)
}

const clearEvents = Effect.gen(function* () {
  const db = yield* Database
  yield* db.delete(billingProviderEvents)
})

const storedEvents = Effect.gen(function* () {
  const db = yield* Database
  return yield* db
    .select()
    .from(billingProviderEvents)
    .where(eq(billingProviderEvents.providerEventId, 'evt_live_ingress'))
})

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })('Stripe webhook ingress', (it) => {
  it.effect(
    'accepts a signed request, persists identity, and enqueues routing data',
    () =>
      Effect.gen(function* () {
        yield* clearEvents
        const d1 = yield* TestD1
        const queue = queueBinding()
        const header = yield* Effect.promise(() => signedHeader(payload))
        const originalFetch = globalThis.fetch
        vi.stubGlobal(
          'fetch',
          vi.fn(() => Promise.reject(new Error('unexpected Stripe fetch')))
        )
        try {
          const response = yield* Effect.promise(() =>
            handleStripeRequest(request(header), configuredEnv(d1, queue))
          )
          expect(response.status).toBe(200)
          expect(queue.send).toHaveBeenCalledTimes(1)
          expect(queue.send).toHaveBeenCalledWith(
            expect.objectContaining({
              kind: 'billing.provider_event',
              providerEventId: 'evt_live_ingress',
              eventType: 'customer.subscription.created',
              providerCreatedAt: '2026-09-21T14:13:20.000Z',
              workspaceId: 'wrk_live',
              subscription: {
                customerId: 'cus_live_ingress',
                subscriptionId: 'sub_live_ingress',
                subscriptionItemId: 'si_live_ingress',
                quantity: 3
              }
            })
          )
          expect(yield* storedEvents).toMatchObject([
            {
              providerEventId: 'evt_live_ingress',
              eventType: 'customer.subscription.created',
              stripeCustomerId: 'cus_live_ingress',
              stripeSubscriptionId: 'sub_live_ingress'
            }
          ])
          expect(globalThis.fetch).not.toHaveBeenCalled()
        } finally {
          vi.stubGlobal('fetch', originalFetch)
        }
      })
  )

  it.effect('keeps the durable row when queue delivery rejects', () =>
    Effect.gen(function* () {
      yield* clearEvents
      const d1 = yield* TestD1
      const queue = {
        send: vi.fn(() => Promise.reject(new Error('queue unavailable')))
      } satisfies SeatSyncQueueBinding
      const header = yield* Effect.promise(() => signedHeader(payload))
      const response = yield* Effect.promise(() =>
        handleStripeRequest(request(header), configuredEnv(d1, queue))
      )
      expect(response.status).toBe(500)
      expect(queue.send).toHaveBeenCalledTimes(1)
      expect(yield* storedEvents).toHaveLength(1)
    })
  )

  it.effect('deduplicates repeated receipts in durable billing evidence', () =>
    Effect.gen(function* () {
      yield* clearEvents
      const d1 = yield* TestD1
      const queue = queueBinding()
      const header = yield* Effect.promise(() => signedHeader(payload))
      const first = yield* Effect.promise(() =>
        handleStripeRequest(request(header), configuredEnv(d1, queue))
      )
      const second = yield* Effect.promise(() =>
        handleStripeRequest(request(header), configuredEnv(d1, queue))
      )
      expect(first.status).toBe(200)
      expect(second.status).toBe(200)
      expect(yield* storedEvents).toHaveLength(1)
      expect(queue.send).toHaveBeenCalledTimes(2)
    })
  )

  it.effect('rejects a bad signature before persistence or enqueue', () =>
    Effect.gen(function* () {
      yield* clearEvents
      const d1 = yield* TestD1
      const queue = queueBinding()
      const validHeader = yield* Effect.promise(() => signedHeader(payload))
      let replacement = '0'
      if (validHeader.endsWith('0')) {
        replacement = '1'
      }
      const badHeader = validHeader.slice(0, -1) + replacement
      const response = yield* Effect.promise(() =>
        handleStripeRequest(request(badHeader), configuredEnv(d1, queue))
      )
      expect(response.status).toBe(400)
      expect(yield* storedEvents).toHaveLength(0)
      expect(queue.send).not.toHaveBeenCalled()
    })
  )

  it.effect('returns 503 when any required ingress configuration is absent', () =>
    Effect.gen(function* () {
      yield* clearEvents
      const d1 = yield* TestD1
      const header = yield* Effect.promise(() => signedHeader(payload))
      const missing = [
        missingEnv(d1, 'DB'),
        missingEnv(d1, 'STRIPE_SECRET_KEY'),
        missingEnv(d1, 'STRIPE_PRICE_ID_TEAM'),
        missingEnv(d1, 'STRIPE_WEBHOOK_SECRET'),
        missingEnv(d1, 'BILLING_QUEUE')
      ]
      for (const { queue, env } of missing) {
        const response = yield* Effect.promise(() =>
          handleStripeRequest(request(header), env)
        )
        expect(response.status).toBe(503)
        expect(queue.send).not.toHaveBeenCalled()
      }
      expect(yield* storedEvents).toHaveLength(0)
    })
  )

  it.effect('returns 500 on a database failure without enqueueing', () =>
    Effect.gen(function* () {
      yield* clearEvents
      const d1 = yield* TestD1
      const queue = queueBinding()
      const brokenD1 = new Proxy(d1, {
        get(target, property, receiver) {
          if (property === 'prepare') {
            return () => {
              throw new Error('D1 unavailable')
            }
          }
          // oxlint-disable-next-line anti-slop/no-reflect-get -- the proxy forwards every real D1 method unchanged
          return Reflect.get(target, property, receiver)
        }
      })
      const header = yield* Effect.promise(() => signedHeader(payload))
      const response = yield* Effect.promise(() =>
        handleStripeRequest(request(header), configuredEnv(brokenD1, queue))
      )
      expect(response.status).toBe(500)
      expect(queue.send).not.toHaveBeenCalled()
      expect(yield* storedEvents).toHaveLength(0)
    })
  )
})
