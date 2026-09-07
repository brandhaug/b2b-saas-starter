import { Effect, Schema } from 'effect'
import { expect, it } from '@effect/vitest'
import { vi } from 'vite-plus/test'
import { emptySubscription } from './billing-state.ts'
import { retrievePaymentEvidence } from './stripe-payment.ts'
import { testItem, testSubscriptionFields } from './provider-test-fixtures.ts'
import { StripeTimestamp, type StripeSubscriptionResponse } from './stripe.ts'

const subscription: StripeSubscriptionResponse = {
  ...testSubscriptionFields,
  id: 'sub_payment',
  customer: 'cus_payment',
  status: 'past_due',
  latest_invoice: 'in_current',
  metadata: { workspaceId: 'wrk_payment' },
  items: { data: [testItem] }
}
function invoice(id: string, amount: number, paidAt: number | null) {
  let status = 'open'
  if (paidAt !== null) {
    status = 'paid'
  }
  return {
    id,
    customer: 'cus_payment',
    created: Date.parse('2026-09-01T00:00:00.000Z') / 1000,
    amount_paid: amount,
    status,
    parent: { subscription_details: { subscription: subscription.id } },
    status_transitions: { paid_at: paidAt }
  }
}
const paymentAt = Date.parse('2026-09-01T00:00:00.000Z') / 1000
const firstFailure = paymentAt + 86_400

it.effect(
  'recovers the earliest actual failure across provider pages and skips retry history once persisted',
  () => {
    const paths: Array<string> = []
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) => {
        const url = new URL(input)
        paths.push(url.pathname + url.search)
        if (url.pathname === '/v1/invoices') {
          return Promise.resolve(
            Response.json({
              data: [invoice('in_previous', 1200, paymentAt)],
              has_more: false
            })
          )
        }
        if (url.pathname === '/v1/invoices/in_current') {
          return Promise.resolve(Response.json(invoice('in_current', 0, null)))
        }
        const second = url.searchParams.has('starting_after')
        let eventId = 'evt_retry'
        let created = firstFailure + 86_400
        if (second) {
          eventId = 'evt_first'
          created = firstFailure
        }
        return Promise.resolve(
          Response.json({
            has_more: !second,
            data: [
              {
                id: eventId,
                type: 'invoice.payment_failed',
                created,
                data: { object: invoice('in_current', 0, null) }
              }
            ]
          })
        )
      })
    )
    return Effect.gen(function* () {
      const evidence = yield* retrievePaymentEvidence(
        'sk_test',
        subscription,
        null,
        '2026-09-04T00:00:00.000Z'
      )
      expect(evidence.firstFailedAt).toBe('2026-09-02T00:00:00.000Z')
      const previous = {
        ...emptySubscription(subscription.customer),
        subscriptionId: subscription.id,
        lastPaymentAt: evidence.lastPaymentAt,
        firstFailedAt: evidence.firstFailedAt
      }
      paths.length = 0
      const retry = yield* retrievePaymentEvidence(
        'sk_test',
        subscription,
        previous,
        '2026-09-05T00:00:00.000Z'
      )
      expect(retry.firstFailedAt).toBe(evidence.firstFailedAt)
      expect(paths.some((path) => path.startsWith('/v1/events'))).toBe(false)
    }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals())))
  }
)

it.effect(
  'accepts a settled credit-covered renewal while a zero-value trial establishes no payment history',
  () => {
    let history = true
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) => {
        const current = invoice('in_current', 0, paymentAt + 86_400)
        const data = [current]
        if (history) {
          data.push(invoice('in_previous', 1200, paymentAt))
        }
        if (new URL(input).pathname === '/v1/invoices') {
          return Promise.resolve(
            Response.json({
              data,
              has_more: false
            })
          )
        }
        return Promise.resolve(Response.json(current))
      })
    )
    return Effect.gen(function* () {
      const paid = yield* retrievePaymentEvidence(
        'sk_test',
        { ...subscription, status: 'active' },
        null,
        '2026-09-04T00:00:00.000Z'
      )
      expect(paid.currentInvoicePaid).toBe(true)
      expect(paid.lastPaymentAt).toBe('2026-09-02T00:00:00.000Z')
      history = false
      const trial = yield* retrievePaymentEvidence(
        'sk_test',
        { ...subscription, status: 'trialing' },
        null,
        '2026-09-04T00:00:00.000Z'
      )
      expect(trial.lastPaymentAt).toBeNull()
    }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals())))
  }
)

it.effect(
  'rebuilds paying history past a full zero-due page and keeps the latest settlement monotonic',
  () => {
    const paths: Array<string> = []
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) => {
        const url = new URL(input)
        paths.push(url.pathname + url.search)
        if (url.pathname === '/v1/invoices') {
          const second = url.searchParams.has('starting_after')
          let data = Array.from({ length: 100 }, (_, i) =>
            invoice(`in_credit_${i}`, 0, paymentAt + 2 * 86_400)
          )
          if (second) {
            data = [invoice('in_positive', 1200, paymentAt)]
          }
          return Promise.resolve(
            Response.json({
              data,
              has_more: !second
            })
          )
        }
        return Promise.resolve(
          Response.json({ ...invoice('in_current', 0, null), status: 'draft' })
        )
      })
    )
    return Effect.gen(function* () {
      const active = {
        ...subscription,
        status: 'active'
      } satisfies StripeSubscriptionResponse
      const rebuilt = yield* retrievePaymentEvidence(
        'sk_test',
        active,
        null,
        '2026-09-05T00:00:00.000Z'
      )
      expect(rebuilt.lastPaymentAt).toBe('2026-09-03T00:00:00.000Z')
      expect(paths.some((path) => path.includes('starting_after=in_credit_99'))).toBe(
        true
      )
      const retained = yield* retrievePaymentEvidence(
        'sk_test',
        active,
        {
          ...emptySubscription(subscription.customer),
          subscriptionId: subscription.id,
          lastPaymentAt: '2026-09-04T00:00:00.000Z'
        },
        '2026-09-05T00:00:00.000Z'
      )
      expect(retained.lastPaymentAt).toBe('2026-09-04T00:00:00.000Z')
    }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals())))
  }
)

it.effect(
  'finds a new failure episode after a missed credit settlement with another latest invoice',
  () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) => {
        const url = new URL(input)
        if (url.pathname === '/v1/invoices') {
          return Promise.resolve(
            Response.json({
              data: [
                invoice('in_positive', 1200, paymentAt),
                invoice('in_credit', 0, paymentAt + 3 * 86_400)
              ],
              has_more: false
            })
          )
        }
        if (url.pathname === '/v1/events') {
          return Promise.resolve(
            Response.json({
              data: [
                {
                  id: 'evt_unrelated',
                  type: 'invoice.payment_failed',
                  created: paymentAt + 3 * 86_400 + 1,
                  data: { object: { id: 'in_other_subscription' } }
                },
                {
                  id: 'evt_new_failure',
                  type: 'invoice.payment_failed',
                  created: paymentAt + 4 * 86_400,
                  data: { object: { id: 'in_current' } }
                }
              ],
              has_more: false
            })
          )
        }
        return Promise.resolve(Response.json(invoice('in_current', 0, null)))
      })
    )
    return Effect.gen(function* () {
      const evidence = yield* retrievePaymentEvidence(
        'sk_test',
        subscription,
        {
          ...emptySubscription(subscription.customer),
          subscriptionId: subscription.id,
          lastPaymentAt: '2026-09-01T00:00:00.000Z',
          firstFailedAt: '2026-09-02T00:00:00.000Z'
        },
        '2026-09-06T00:00:00.000Z'
      )
      expect(evidence.lastPaymentAt).toBe('2026-09-04T00:00:00.000Z')
      expect(evidence.firstFailedAt).toBe('2026-09-05T00:00:00.000Z')
    }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals())))
  }
)

it.effect('fails visibly when a paid-history page cannot advance', () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(Response.json({ data: [], has_more: true })))
  )
  return Effect.gen(function* () {
    const error = yield* Effect.flip(
      retrievePaymentEvidence('sk_test', subscription, null, '2026-09-06T00:00:00.000Z')
    )
    expect(error.reason).toBe('payment_history_incomplete')
  }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals())))
})

const decodeTimestamp = Schema.decodeUnknownResult(StripeTimestamp)

it('bounds provider timestamps before conversion or grace arithmetic', () => {
  expect(decodeTimestamp(253_402_300_799)._tag).toBe('Success')
  for (const seconds of [
    -1,
    253_402_300_800,
    8_640_000_000_000,
    Number.MAX_SAFE_INTEGER
  ]) {
    expect(decodeTimestamp(seconds)._tag).toBe('Failure')
  }
})
