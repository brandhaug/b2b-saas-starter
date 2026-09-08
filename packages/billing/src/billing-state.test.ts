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
