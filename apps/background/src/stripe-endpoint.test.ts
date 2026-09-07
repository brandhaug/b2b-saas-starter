import {
  Billing,
  type ProcessProviderEventInput,
  type ProcessProviderEventResult
} from '@b2b-saas-starter/capabilities/billing/billing'
import { Effect, Layer } from 'effect'
import { describe, expect, it } from '@effect/vitest'

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

type PlanCall = {
  readonly workspaceId: string
  readonly planId: string
  readonly detail?: ProcessProviderEventInput['detail']
}
type SubscriptionCall = NonNullable<ProcessProviderEventInput['subscription']>

/** What one test run records off the stubbed capability. */
type RecordedCalls = {
  readonly plans: Array<PlanCall>
  readonly subscriptions: Array<SubscriptionCall>
  readonly events: Array<ProcessProviderEventInput>
}

function recordingBilling(calls: RecordedCalls) {
  return Layer.succeed(Billing)({
    configured: Effect.succeed(false),
    currentPlanForWorkspace: () => Effect.die('unused'),
    lifecycleStatus: Effect.die('unused'),
    displayedPlans: Effect.die('unused'),
    currentPlan: Effect.die('not used here'),
    synchronizationStatus: Effect.die('not used here'),
    reconcileWorkspace: () => Effect.die('not used here'),
    reconcileBatch: () => Effect.die('not used here'),
    startCheckout: () => Effect.die('not used here'),
    startPortalSession: () => Effect.die('not used here'),
    processProviderEvent: (input: ProcessProviderEventInput) =>
      Effect.sync(() => {
        calls.events.push(input)
        if (input.planId !== undefined && input.workspaceId !== undefined) {
          calls.plans.push({
            workspaceId: input.workspaceId,
            planId: input.planId,
            detail: input.detail
          })
        }
        if (input.subscription !== undefined) {
          calls.subscriptions.push(input.subscription)
        }
        return {
          outcome: 'applied',
          providerEventId: input.providerEventId
        } satisfies ProcessProviderEventResult
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
  const calls: RecordedCalls = { plans: [], subscriptions: [], events: [] }
  return Effect.map(
    processStripeEvent(payloadOf(fixture)).pipe(
      Effect.provide(recordingBilling(calls))
    ),
    () => calls
  )
}

describe('processStripeEvent', () => {
  it.effect('maps checkout completion to one authoritative subscription event', () =>
    Effect.gen(function* () {
      const calls = yield* run(checkoutCompleted)
      expect(calls.events).toHaveLength(1)
      expect(calls.plans).toEqual([])
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
      expect(calls.plans).toEqual([])
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
      expect(calls.plans).toEqual([])
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
      expect(calls.plans).toEqual([])
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
      expect(calls.plans).toEqual([])
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
      expect(calls.plans).toEqual([])
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
        expect(calls.plans).toEqual([])
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
      expect(calls.plans).toEqual([])
      expect(calls.subscriptions).toEqual([])
    })
  )
})

it.effect(
  'routes invoice recovery, payment action and asynchronous checkout through verified synchronization',
  () =>
    Effect.gen(function* () {
      const calls: RecordedCalls = { plans: [], subscriptions: [], events: [] }
      const invoiceTypes = [
        'invoice.paid',
        'invoice.payment_succeeded',
        'invoice.payment_failed',
        'invoice.payment_action_required'
      ]
      for (const type of invoiceTypes) {
        yield* processStripeEvent(
          payloadOf({
            id: `evt_${type}`,
            created: 1_788_739_200,
            type,
            data: {
              object: {
                id: 'in_current',
                customer: 'cus_lifecycle',
                parent: { subscription_details: { subscription: 'sub_lifecycle' } }
              }
            }
          })
        ).pipe(Effect.scoped, Effect.provide(recordingBilling(calls)))
      }
      for (const type of [
        'checkout.session.async_payment_succeeded',
        'checkout.session.async_payment_failed'
      ]) {
        yield* processStripeEvent(
          payloadOf({
            id: `evt_${type}`,
            created: 1_788_739_200,
            type,
            data: {
              object: {
                id: 'cs_async',
                customer: 'cus_lifecycle',
                subscription: 'sub_lifecycle'
              }
            }
          })
        ).pipe(Effect.scoped, Effect.provide(recordingBilling(calls)))
      }
      expect(calls.events).toHaveLength(6)
      expect(
        calls.events.every(
          (event) =>
            event.subscription?.customerId === 'cus_lifecycle' &&
            event.subscription.subscriptionId === 'sub_lifecycle'
        )
      ).toBe(true)
      expect(calls.plans).toHaveLength(0)
    })
)
