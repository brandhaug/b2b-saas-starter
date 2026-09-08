import { type ProcessProviderEventInput } from '@b2b-saas-starter/capabilities/billing/billing'
import { Effect } from 'effect'
import { describe, expect, it } from '@effect/vitest'

import checkoutCompleted from './fixtures/stripe/checkout.session.completed.json'
import subscriptionCreated from './fixtures/stripe/customer.subscription.created.json'
import subscriptionDeleted from './fixtures/stripe/customer.subscription.deleted.json'
import subscriptionUpdated from './fixtures/stripe/customer.subscription.updated.json'
import { providerInputFromPayload } from './stripe-endpoint.ts'

/**
 * The Stripe webhook core, driven by recorded event fixtures: the exact JSON
 * bodies Stripe posts for the four event types the worker handles. The
 * `Billing` service is a recording stub, so the tests assert the mapping —
 * which event becomes which capability call — without a provider or a D1.
 */

type SubscriptionCall = NonNullable<ProcessProviderEventInput['subscription']>

/** What one test run records off the stubbed capability. */
type RecordedCalls = {
  readonly subscriptions: Array<SubscriptionCall>
  readonly events: Array<ProcessProviderEventInput>
}

// The fixture is checked-in, trusted JSON; the decoder under test owns the
// real parse, so stringifying here adds no untrusted-input surface.
function payloadOf(fixture: unknown): string {
  // oxlint-disable-next-line effect/noGlobals -- see the comment above
  return JSON.stringify(fixture)
}

function run(fixture: unknown) {
  const calls: RecordedCalls = { subscriptions: [], events: [] }
  const input = providerInputFromPayload(payloadOf(fixture))
  if (input !== undefined) {
    calls.events.push(input)
    if (input.subscription !== undefined) {
      calls.subscriptions.push(input.subscription)
    }
  }
  return Effect.succeed(calls)
}

describe('providerInputFromPayload', () => {
  it.effect('maps checkout completion to one authoritative subscription event', () =>
    Effect.gen(function* () {
      const calls = yield* run(checkoutCompleted)
      expect(calls.events).toHaveLength(1)
      expect(calls.subscriptions).toEqual([
        {
          workspaceId: 'wrk_starter',
          customerId: 'cus_seed_starter_lab',
          subscriptionId: 'sub_seed_starter_lab',
          subscriptionItemId: undefined,
          quantity: undefined,
          deleted: undefined,
          detail: {
            source: 'checkout.session.completed',
            providerEventId: 'evt_checkout_completed_seed',
            providerCreatedAt: '2026-09-21T14:13:20.000Z'
          }
        }
      ])
    })
  )

  it.effect('does not require checkout plan metadata', () =>
    Effect.gen(function* () {
      const calls = yield* run({
        id: 'evt_checkout_without_plan',
        created: 1_790_000_050,
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_without_plan',
            client_reference_id: 'wrk_starter',
            customer: 'cus_seed_starter_lab',
            subscription: 'sub_seed_starter_lab',
            metadata: { workspaceId: 'wrk_starter' }
          }
        }
      })
      expect(calls.events).toHaveLength(1)
      expect(calls.subscriptions[0]).toMatchObject({
        workspaceId: 'wrk_starter',
        customerId: 'cus_seed_starter_lab',
        subscriptionId: 'sub_seed_starter_lab'
      })
    })
  )

  it.effect('reconciles the seat quantity from a subscription update', () =>
    Effect.gen(function* () {
      const calls = yield* run(subscriptionUpdated)
      expect(calls.events).toHaveLength(1)
      // No plan change rides a quantity update — the checkout already set it.
      expect(calls.subscriptions).toEqual([
        {
          workspaceId: 'wrk_starter',
          customerId: 'cus_seed_starter_lab',
          subscriptionId: 'sub_seed_starter_lab',
          subscriptionItemId: 'si_seed_starter_lab',
          quantity: 6,
          deleted: undefined,
          detail: {
            source: 'customer.subscription.updated',
            providerEventId: 'evt_subscription_updated_seed',
            providerCreatedAt: '2026-09-21T14:13:40.000Z'
          }
        }
      ])
    })
  )

  it.effect('maps deletion with provider identities for stale metadata recovery', () =>
    Effect.gen(function* () {
      const calls = yield* run(subscriptionDeleted)
      expect(calls.events).toHaveLength(1)
      expect(calls.subscriptions).toEqual([
        {
          workspaceId: 'wrk_starter',
          customerId: 'cus_seed_starter_lab',
          subscriptionId: 'sub_seed_starter_lab',
          subscriptionItemId: undefined,
          quantity: undefined,
          deleted: true,
          detail: {
            source: 'customer.subscription.deleted',
            providerEventId: 'evt_subscription_deleted_seed',
            providerCreatedAt: '2026-09-21T14:13:50.000Z'
          }
        }
      ])
    })
  )

  it.effect('records the first subscription state without a plan change', () =>
    Effect.gen(function* () {
      const calls = yield* run(subscriptionCreated)
      expect(calls.subscriptions[0]).toMatchObject({
        workspaceId: 'wrk_starter',
        subscriptionItemId: 'si_seed_starter_lab',
        quantity: 4
      })
    })
  )

  it.effect('ignores unhandled event types without calling the capability', () =>
    Effect.gen(function* () {
      const calls = yield* run({
        type: 'invoice.paid',
        data: { object: { customer: 'cus_seed_starter_lab' } }
      })
      expect(calls.subscriptions).toEqual([])
    })
  )

  it.effect(
    'forwards a handled event without workspace metadata for capability resolution',
    () =>
      Effect.gen(function* () {
        const calls = yield* run({
          id: 'evt_subscription_missing_workspace',
          created: 1_790_000_040,
          type: 'customer.subscription.updated',
          data: {
            object: { id: 'sub_x', items: { data: [{ id: 'si_x', quantity: 2 }] } }
          }
        })
        expect(calls.events).toHaveLength(1)
        expect(calls.subscriptions).toMatchObject([
          {
            customerId: undefined,
            subscriptionId: 'sub_x',
            subscriptionItemId: 'si_x',
            quantity: 2
          }
        ])
      })
  )

  it.effect('skips provider timestamps outside the supported epoch range', () =>
    Effect.gen(function* () {
      for (const created of [1e100, -1, 1.5]) {
        const calls = yield* run({ ...subscriptionCreated, created })
        expect(calls.events).toEqual([])
      }
    })
  )

  it.effect('tolerates a malformed body as a skip, not a failure', () =>
    Effect.gen(function* () {
      const calls = yield* run({ type: 'checkout.session.completed', data: 'nope' })
      expect(calls.subscriptions).toEqual([])
    })
  )
})
