import {
  Billing,
  type ApplySubscriptionEventInput
} from '@b2b-saas-starter/capabilities/billing/billing'
import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vite-plus/test'

import checkoutCompleted from './fixtures/stripe/checkout.session.completed.json'
import subscriptionCreated from './fixtures/stripe/customer.subscription.created.json'
import subscriptionDeleted from './fixtures/stripe/customer.subscription.deleted.json'
import subscriptionUpdated from './fixtures/stripe/customer.subscription.updated.json'
import { processStripeEvent } from './stripe-endpoint.ts'

/**
 * The Stripe webhook core, driven by recorded event fixtures: the exact JSON
 * bodies Stripe posts for the four event types the worker handles. The
 * `Billing` service is a recording stub, so the tests assert the mapping —
 * which event becomes which capability call — without a provider or a D1.
 */

type PlanCall = { readonly workspaceId: string; readonly planId: string }
type SubscriptionCall = ApplySubscriptionEventInput

/** What one test run records off the stubbed capability. */
type RecordedCalls = {
  readonly plans: Array<PlanCall>
  readonly subscriptions: Array<SubscriptionCall>
}

function recordingBilling(calls: RecordedCalls) {
  return Layer.succeed(Billing)({
    configured: Effect.succeed(false),
    currentPlan: Effect.die('not used here'),
    startCheckout: () => Effect.die('not used here'),
    startPortalSession: () => Effect.die('not used here'),
    applyProviderEvent: (input: { workspaceId: string; planId: string }) =>
      Effect.sync(() => {
        calls.plans.push(input)
        return true
      }),
    applySubscriptionEvent: (input: ApplySubscriptionEventInput) =>
      Effect.sync(() => {
        calls.subscriptions.push(input)
        return true
      }),
    syncSeats: () => Effect.die('not used here')
  })
}

// The fixture is checked-in, trusted JSON; the decoder under test owns the
// real parse, so stringifying here adds no untrusted-input surface.
function payloadOf(fixture: unknown): string {
  // oxlint-disable-next-line effect/noGlobals -- see the comment above
  return JSON.stringify(fixture)
}

function run(fixture: unknown) {
  const calls: RecordedCalls = { plans: [], subscriptions: [] }
  return Effect.map(
    Effect.scoped(
      processStripeEvent(payloadOf(fixture)).pipe(
        Effect.provide(recordingBilling(calls))
      )
    ),
    () => calls
  )
}

describe('processStripeEvent', () => {
  it('maps checkout completion to a plan change plus a subscription link', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const calls = yield* run(checkoutCompleted)
        expect(calls.plans).toEqual([
          {
            workspaceId: 'wrk_starter',
            planId: 'team',
            detail: { source: 'checkout.session.completed' }
          }
        ])
        expect(calls.subscriptions).toEqual([
          {
            workspaceId: 'wrk_starter',
            customerId: 'cus_seed_starter_lab',
            subscriptionId: 'sub_seed_starter_lab',
            subscriptionItemId: undefined,
            quantity: undefined,
            deleted: undefined,
            detail: { source: 'checkout.session.completed' }
          }
        ])
      })
    ))

  it('reconciles the seat quantity from a subscription update', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const calls = yield* run(subscriptionUpdated)
        // No plan change rides a quantity update — the checkout already set it.
        expect(calls.plans).toEqual([])
        expect(calls.subscriptions).toEqual([
          {
            workspaceId: 'wrk_starter',
            customerId: 'cus_seed_starter_lab',
            subscriptionId: 'sub_seed_starter_lab',
            subscriptionItemId: 'si_seed_starter_lab',
            quantity: 6,
            deleted: undefined,
            detail: { source: 'customer.subscription.updated' }
          }
        ])
      })
    ))

  it('maps deletion to the downgrade plus a seat-item detach', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const calls = yield* run(subscriptionDeleted)
        expect(calls.plans).toEqual([
          {
            workspaceId: 'wrk_starter',
            planId: 'starter',
            detail: { source: 'customer.subscription.deleted' }
          }
        ])
        expect(calls.subscriptions).toEqual([
          {
            workspaceId: 'wrk_starter',
            customerId: undefined,
            subscriptionId: undefined,
            subscriptionItemId: undefined,
            quantity: undefined,
            deleted: true,
            detail: { source: 'customer.subscription.deleted' }
          }
        ])
      })
    ))

  it('records the first subscription state without a plan change', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const calls = yield* run(subscriptionCreated)
        expect(calls.plans).toEqual([])
        expect(calls.subscriptions[0]).toMatchObject({
          workspaceId: 'wrk_starter',
          subscriptionItemId: 'si_seed_starter_lab',
          quantity: 4
        })
      })
    ))

  it('ignores unhandled event types without calling the capability', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const calls = yield* run({
          type: 'invoice.paid',
          data: { object: { customer: 'cus_seed_starter_lab' } }
        })
        expect(calls.plans).toEqual([])
        expect(calls.subscriptions).toEqual([])
      })
    ))

  it('skips a handled event that names no workspace', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const calls = yield* run({
          type: 'customer.subscription.updated',
          data: {
            object: { id: 'sub_x', items: { data: [{ id: 'si_x', quantity: 2 }] } }
          }
        })
        expect(calls.plans).toEqual([])
        expect(calls.subscriptions).toEqual([])
      })
    ))

  it('tolerates a malformed body as a skip, not a failure', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const calls = yield* run({ type: 'checkout.session.completed', data: 'nope' })
        expect(calls.plans).toEqual([])
        expect(calls.subscriptions).toEqual([])
      })
    ))
})
