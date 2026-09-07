import { describe, expect, it } from 'vite-plus/test'

import { type SubscriptionState } from './billing.ts'
import { lifecycleNotices } from './billing-notices.ts'
import { emptySubscription } from './billing-state.ts'

const now = '2026-09-07T00:00:00.000Z'

function failedSubscription(
  overrides: Partial<SubscriptionState> = {}
): SubscriptionState {
  return {
    ...emptySubscription('cus_test'),
    subscriptionId: 'sub_test',
    subscribedPlanId: 'team',
    status: 'past_due',
    lastPaymentAt: '2026-08-31T00:00:00.000Z',
    firstFailedAt: '2026-09-02T00:00:00.000Z',
    graceEndsAt: '2026-09-07T12:00:00.000Z',
    ...overrides
  }
}

describe('lifecycleNotices', () => {
  it('keeps the failure notice truthful and suppresses future access for unpaid', () => {
    const notices = lifecycleNotices(
      null,
      failedSubscription({ status: 'unpaid' }),
      now
    )

    expect(notices).toHaveLength(1)
    expect(notices[0]?.message).toContain('Paid access has ended')
  })

  it('does not promise future access for paused subscriptions', () => {
    const notices = lifecycleNotices(
      null,
      failedSubscription({ status: 'paused' }),
      now
    )

    expect(notices).toHaveLength(1)
    expect(notices[0]?.message).toContain('Paid access has ended')
  })

  it('does not promise future access after cancellation has expired', () => {
    const notices = lifecycleNotices(
      null,
      failedSubscription({
        cancelAtPeriodEnd: true,
        currentPeriodEnd: '2026-09-06T00:00:00.000Z'
      }),
      now
    )

    expect(notices).toHaveLength(1)
    expect(notices[0]?.message).toContain('Paid access has ended')
  })

  it('warns about an actually active renewal grace period', () => {
    const notices = lifecycleNotices(null, failedSubscription(), now)

    expect(notices).toHaveLength(2)
    expect(notices[0]?.message).toContain('before paid access ends on')
    expect(notices[1]?.type).toBe('grace_expiring')
    expect(notices[1]?.message).toContain('Paid access ends on')
  })

  it('keeps retry notice identity fixed and emits recovery after payment succeeds', () => {
    const failed = failedSubscription()
    const retryNotices = lifecycleNotices(failed, failed, now)
    expect(retryNotices.map(({ key }) => key)).toEqual([
      'failed:sub_test:2026-09-02T00:00:00.000Z',
      'expiring:sub_test:2026-09-02T00:00:00.000Z'
    ])

    const recovered: SubscriptionState = {
      ...failed,
      firstFailedAt: null,
      graceEndsAt: null,
      lastPaymentAt: '2026-09-07T00:00:00.000Z',
      paymentVerified: true,
      status: 'active'
    }
    expect(lifecycleNotices(failed, recovered, now)).toEqual([
      {
        key: 'recovered:sub_test:2026-09-07T00:00:00.000Z',
        type: 'payment_recovered',
        title: 'Subscription payment recovered',
        message:
          'Payment succeeded and the subscribed plan is available again. Any administrative suspension remains in effect.'
      }
    ])
  })
})
