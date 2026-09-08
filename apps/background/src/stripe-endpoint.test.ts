import { type ProcessProviderEventInput } from '@b2b-saas-starter/billing/billing'
import { Effect } from 'effect'
import { describe, expect, it } from '@effect/vitest'

import checkoutCompleted from './fixtures/stripe/checkout.session.completed.json'
import subscriptionCreated from './fixtures/stripe/customer.subscription.created.json'
import subscriptionDeleted from './fixtures/stripe/customer.subscription.deleted.json'
import subscriptionUpdated from './fixtures/stripe/customer.subscription.updated.json'
import { providerInputFromPayload } from './stripe-endpoint.ts'

// Recorded provider fixtures exercise the mapper used by HTTP ingress.
type SubscriptionCall = NonNullable<ProcessProviderEventInput['subscription']>

/** Mapped provider inputs collected for fixture assertions. */
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
  it.each([
    'invoice.paid',
    'invoice.payment_succeeded',
    'invoice.payment_failed',
    'invoice.payment_action_required',
    'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed'
  ])('maps %s to provider identities for queued reconciliation', (type) => {
    let object
    if (type.startsWith('invoice.')) {
      object = {
        id: 'in_current',
        customer: 'cus_lifecycle',
        parent: { subscription_details: { subscription: 'sub_lifecycle' } }
      }
    } else {
      object = {
        id: 'cs_async',
        customer: 'cus_lifecycle',
        subscription: 'sub_lifecycle'
      }
    }
    const input = providerInputFromPayload(
      payloadOf({ id: `evt_${type}`, created: 1_788_739_200, type, data: { object } })
    )
    expect(input).toMatchObject({
      providerEventId: `evt_${type}`,
      eventType: type,
      subscription: {
        customerId: 'cus_lifecycle',
        subscriptionId: 'sub_lifecycle'
      }
    })
    expect(input?.planId).toBeUndefined()
  })

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

  it.effect('ignores a valid envelope for an unhandled event type', () =>
    Effect.gen(function* () {
      const calls = yield* run({
        id: 'evt_unhandled',
        created: 1_790_000_000,
        type: 'customer.created',
        data: { object: { customer: 'cus_seed_starter_lab' } }
      })
      expect(calls.subscriptions).toEqual([])
    })
  )

  it('skips invalid JSON', () => {
    expect(providerInputFromPayload('{')).toBeUndefined()
  })

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
