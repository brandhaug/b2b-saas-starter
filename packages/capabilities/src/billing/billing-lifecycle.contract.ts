import { Effect } from 'effect'
import * as TestClock from 'effect/testing/TestClock'
import { type expect } from '@effect/vitest'
import { type WorkspaceNotFound } from '../errors.ts'
import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { type SubscriptionStatus } from '@b2b-saas-starter/billing/billing'
import { type PaymentEvidence } from '@b2b-saas-starter/billing/billing-state'

export type LifecycleSnapshot = {
  readonly status: SubscriptionStatus
  readonly planId: string
  readonly trialEnd: string | null
  readonly cancelAtPeriodEnd: boolean
  readonly currentPeriodEnd: string
  readonly payment: PaymentEvidence
}
export const initialSnapshot: LifecycleSnapshot = {
  status: 'incomplete',
  planId: 'team',
  trialEnd: null,
  cancelAtPeriodEnd: false,
  currentPeriodEnd: '2026-10-01T00:00:00.000Z',
  payment: { lastPaymentAt: null, firstFailedAt: null, currentInvoicePaid: false }
}
export type LifecycleDriver<R> = {
  readonly set: (snapshot: LifecycleSnapshot) => Effect.Effect<void, never, R>
  readonly sync: (
    eventId: string
  ) => Effect.Effect<void, CapabilityUnavailable | WorkspaceNotFound, R>
  readonly plan: Effect.Effect<string, CapabilityUnavailable | WorkspaceNotFound, R>
  readonly grace: Effect.Effect<
    string | null,
    CapabilityUnavailable | WorkspaceNotFound,
    R
  >
}

export function lifecycleContract<R>(
  assert: typeof expect,
  driver: LifecycleDriver<R>
) {
  return Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse('2026-09-01T00:00:00.000Z'))
    yield* driver.set(initialSnapshot)
    yield* driver.sync('checkout_completed')
    assert(yield* driver.plan).toBe('starter')
    // Active alone, including a provider-created $0 trial invoice, is insufficient.
    yield* driver.set({ ...initialSnapshot, status: 'active' })
    yield* driver.sync('active_without_payment')
    assert(yield* driver.plan).toBe('starter')
    const trial = {
      ...initialSnapshot,
      status: 'trialing',
      trialEnd: '2026-09-02T00:00:00.000Z'
    } satisfies LifecycleSnapshot
    yield* driver.set(trial)
    yield* driver.sync('operator_trial')
    assert(yield* driver.plan).toBe('team')
    yield* TestClock.setTime(Date.parse('2026-09-02T00:00:00.000Z'))
    assert(yield* driver.plan).toBe('starter')
    yield* driver.set({
      ...initialSnapshot,
      status: 'past_due',
      payment: {
        lastPaymentAt: null,
        firstFailedAt: '2026-09-02T00:00:00.000Z',
        currentInvoicePaid: false
      }
    })
    yield* driver.sync('trial_conversion_failed')
    assert(yield* driver.plan).toBe('starter')
    assert(yield* driver.grace).toBeNull()
    const paying = {
      ...initialSnapshot,
      status: 'active',
      payment: {
        lastPaymentAt: '2026-09-02T01:00:00.000Z',
        firstFailedAt: null,
        currentInvoicePaid: true
      }
    } satisfies LifecycleSnapshot
    yield* TestClock.setTime(Date.parse('2026-09-02T01:00:00.000Z'))
    yield* driver.set(paying)
    yield* driver.sync('paid_first_invoice')
    assert(yield* driver.plan).toBe('team')
    yield* driver.set({ ...paying, planId: 'enterprise' })
    yield* driver.sync('operator_enterprise')
    assert(yield* driver.plan).toBe('enterprise')
    yield* driver.set(paying)
    yield* driver.sync('portal_downgrade')
    assert(yield* driver.plan).toBe('team')
    yield* driver.set({
      ...paying,
      payment: { ...paying.payment, currentInvoicePaid: false }
    })
    yield* driver.sync('draft_renewal')
    assert(yield* driver.plan).toBe('team')
    assert(yield* driver.grace).toBeNull()
    yield* driver.set(paying)
    yield* driver.sync('draft_renewal_paid')
    assert(yield* driver.plan).toBe('team')
    yield* driver.set({
      ...paying,
      payment: { ...paying.payment, currentInvoicePaid: false }
    })
    yield* driver.sync('next_draft_renewal')
    assert(yield* driver.plan).toBe('team')
    const failed = {
      ...paying,
      status: 'past_due',
      payment: {
        ...paying.payment,
        firstFailedAt: '2026-09-03T00:00:00.000Z',
        currentInvoicePaid: false
      }
    } satisfies LifecycleSnapshot
    yield* TestClock.setTime(Date.parse('2026-09-03T00:00:00.000Z'))
    yield* driver.set(failed)
    yield* driver.sync('failed_renewal')
    assert(yield* driver.plan).toBe('team')
    assert(yield* driver.grace).toBe('2026-09-10T00:00:00.000Z')
    yield* TestClock.setTime(Date.parse('2026-09-04T00:00:00.000Z'))
    yield* driver.set({ ...failed, status: 'unpaid' })
    yield* driver.sync('unpaid_before_grace')
    assert(yield* driver.grace).toBe('2026-09-10T00:00:00.000Z')
    assert(yield* driver.plan).toBe('starter')
    yield* TestClock.setTime(Date.parse('2026-09-09T12:00:00.000Z'))
    yield* driver.set({
      ...failed,
      payment: { ...failed.payment, firstFailedAt: '2026-09-09T12:00:00.000Z' }
    })
    yield* driver.sync('failed_retry')
    yield* driver.sync('failed_retry')
    assert(yield* driver.grace).toBe('2026-09-10T00:00:00.000Z')
    assert(yield* driver.plan).toBe('team')
    yield* TestClock.setTime(Date.parse('2026-09-10T00:00:00.000Z'))
    assert(yield* driver.plan).toBe('starter')
    yield* driver.sync('reconcile_expired_grace')
    assert(yield* driver.plan).toBe('starter')
    const recovery = {
      ...paying,
      payment: { ...paying.payment, lastPaymentAt: '2026-09-10T01:00:00.000Z' }
    }
    yield* driver.set(recovery)
    yield* driver.sync('paid_recovery')
    assert(yield* driver.plan).toBe('team')
    yield* driver.set({
      ...failed,
      payment: {
        ...failed.payment,
        lastPaymentAt: recovery.payment.lastPaymentAt,
        firstFailedAt: '2026-09-11T00:00:00.000Z'
      }
    })
    yield* driver.sync('new_failure')
    assert(yield* driver.grace).toBe('2026-09-18T00:00:00.000Z')
    // A missed settlement must close the old episode even with a newer failed invoice.
    yield* driver.set({
      ...failed,
      payment: {
        lastPaymentAt: '2026-09-12T00:00:00.000Z',
        firstFailedAt: '2026-09-13T00:00:00.000Z',
        currentInvoicePaid: false
      }
    })
    yield* driver.sync('missed_settlement_new_failure')
    assert(yield* driver.grace).toBe('2026-09-20T00:00:00.000Z')
    yield* driver.set({
      ...recovery,
      payment: { ...recovery.payment, lastPaymentAt: '2026-09-14T00:00:00.000Z' }
    })
    yield* driver.sync('second_recovery')
    assert(yield* driver.plan).toBe('team')
    assert(yield* driver.grace).toBeNull()
    yield* driver.set({ ...recovery, cancelAtPeriodEnd: true })
    yield* driver.sync('scheduled_cancellation')
    assert(yield* driver.plan).toBe('team')
    yield* driver.set(recovery)
    yield* driver.sync('cancellation_undone')
    assert(yield* driver.plan).toBe('team')
    yield* driver.set({ ...recovery, cancelAtPeriodEnd: true })
    yield* driver.sync('scheduled_again')
    yield* TestClock.setTime(Date.parse(initialSnapshot.currentPeriodEnd))
    assert(yield* driver.plan).toBe('starter')
    yield* driver.set({ ...recovery, currentPeriodEnd: '2026-11-01T00:00:00.000Z' })
    yield* driver.sync('renewed')
    assert(yield* driver.plan).toBe('team')
    const terminalStatuses: ReadonlyArray<SubscriptionStatus> = [
      'unpaid',
      'paused',
      'canceled',
      'incomplete_expired'
    ]
    for (const status of terminalStatuses) {
      yield* driver.set({ ...failed, status })
      yield* driver.sync(`final_${status}`)
      assert(yield* driver.plan).toBe('starter')
    }
  })
}
