import { billingLifecycleStatuses } from '@b2b-saas-starter/db/enums'
import { Schema } from 'effect'
import { SubscriptionState } from './billing.ts'
import { describe, expect, it } from 'vite-plus/test'

import { effectivePlanDecision, emptySubscription } from './billing-state.ts'

const decodeSubscription = Schema.decodeUnknownSync(SubscriptionState)

const now = '2026-09-07T00:00:00.000Z'

describe('effectivePlanDecision', () => {
  it('expires a trial without granting renewal grace', () => {
    expect(
      effectivePlanDecision(
        {
          ...emptySubscription('cus_test'),
          lastPaymentAt: '2026-09-01T00:00:00.000Z',
          subscribedPlanId: 'team',
          status: 'trialing',
          trialEnd: '2026-09-06T23:59:59.000Z'
        },
        now
      )
    ).toEqual({ planId: 'starter', paid: false, reason: 'trial_expired' })
  })

  it('retains a previously paid plan only until its fixed grace deadline', () => {
    expect(
      effectivePlanDecision(
        {
          ...emptySubscription('cus_test'),
          lastPaymentAt: '2026-09-01T00:00:00.000Z',
          subscribedPlanId: 'team',
          status: 'past_due',
          graceEndsAt: '2026-09-08T00:00:00.000Z'
        },
        now
      ).paid
    ).toBe(true)
    expect(
      effectivePlanDecision(
        {
          ...emptySubscription('cus_test'),
          lastPaymentAt: '2026-09-01T00:00:00.000Z',
          subscribedPlanId: 'team',
          status: 'past_due',
          graceEndsAt: '2026-09-06T00:00:00.000Z'
        },
        now
      )
    ).toEqual({ planId: 'starter', paid: false, reason: 'past_due' })
  })

  it('ends access immediately for unpaid subscriptions', () => {
    expect(
      effectivePlanDecision(
        {
          ...emptySubscription('cus_test'),
          lastPaymentAt: '2026-09-01T00:00:00.000Z',
          subscribedPlanId: 'team',
          status: 'unpaid'
        },
        now
      ).planId
    ).toBe('starter')
  })
})

it('rejects noncanonical persisted timestamps before lexical episode comparisons', () => {
  for (const lastPaymentAt of [
    '2026-09-01',
    '2026-09-01T01:00:00+01:00',
    '2026-02-30T00:00:00.000Z',
    '2026-09-01T00:00:00Z'
  ]) {
    expect(() =>
      decodeSubscription({
        ...emptySubscription('cus_test'),
        lastPaymentAt
      })
    ).toThrow('Expected a valid billing timestamp')
  }
  expect(
    decodeSubscription({
      ...emptySubscription('cus_test'),
      lastPaymentAt: now
    }).lastPaymentAt
  ).toBe(now)
})

const graceEndsAt = '2026-09-08T00:00:00.000Z'
const deadlines = [
  { when: 'before', now: '2026-09-07T00:00:00.000Z', within: true },
  { when: 'at', now: graceEndsAt, within: false },
  { when: 'after', now: '2026-09-09T00:00:00.000Z', within: false }
]
/**
 * The lifecycle statuses a previously paying workspace can hold access
 * through. Stripe reports a failing renewal as `active` until it gives up, so
 * grace follows the payment evidence rather than the reported status; the
 * statuses left out have ended access outright (ADR 0076).
 */
const graceStatuses = new Set(['active', 'trialing', 'past_due'])

const graceCases = billingLifecycleStatuses.flatMap((status) =>
  deadlines.map((deadline) => ({
    status,
    when: deadline.when,
    now: deadline.now,
    granted: graceStatuses.has(status) && deadline.within
  }))
)

describe('renewal grace across the lifecycle', () => {
  it.each(graceCases)('$status $when the deadline', ({ status, now: at, granted }) => {
    const decision = effectivePlanDecision(
      {
        ...emptySubscription('cus_test'),
        subscribedPlanId: 'team',
        status,
        currentPeriodEnd: '2026-10-01T00:00:00.000Z',
        lastPaymentAt: '2026-09-01T00:00:00.000Z',
        firstFailedAt: '2026-09-01T00:00:00.000Z',
        graceEndsAt
      },
      at
    )
    let planId = 'starter'
    if (granted) {
      planId = 'team'
    }
    expect(decision.paid).toBe(granted)
    expect(decision.planId).toBe(planId)
  })

  it('grants no grace without an established payment', () => {
    expect(
      effectivePlanDecision(
        {
          ...emptySubscription('cus_test'),
          subscribedPlanId: 'team',
          status: 'past_due',
          firstFailedAt: '2026-09-01T00:00:00.000Z',
          graceEndsAt
        },
        '2026-09-07T00:00:00.000Z'
      ).paid
    ).toBe(false)
  })
})

describe('cancellation at period end', () => {
  const canceling = {
    ...emptySubscription('cus_test'),
    subscribedPlanId: 'team',
    status: 'active',
    paymentVerified: true,
    lastPaymentAt: '2026-09-01T00:00:00.000Z',
    cancelAtPeriodEnd: true,
    currentPeriodEnd: '2026-09-08T00:00:00.000Z'
  } satisfies SubscriptionState

  it('retains the subscribed plan until the paid period ends', () => {
    expect(effectivePlanDecision(canceling, '2026-09-07T00:00:00.000Z')).toEqual({
      planId: 'team',
      paid: true,
      reason: 'active'
    })
  })

  it('drops to starter once the period has passed, grace or not', () => {
    expect(
      effectivePlanDecision(
        { ...canceling, firstFailedAt: '2026-09-06T00:00:00.000Z', graceEndsAt },
        '2026-09-09T00:00:00.000Z'
      ).paid
    ).toBe(false)
  })
})
