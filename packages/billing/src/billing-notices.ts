import { type SubscriptionState } from './billing.ts'
import { effectivePlanDecision } from './billing-state.ts'

export type BillingNotice = {
  readonly key: string
  readonly type: 'payment_failed' | 'grace_expiring' | 'payment_recovered'
  readonly title: string
  readonly message: string
}

export function lifecycleNotices(
  previous: SubscriptionState | null,
  next: SubscriptionState,
  now: string
): ReadonlyArray<BillingNotice> {
  const notices: Array<BillingNotice> = []
  const effective = effectivePlanDecision(next, now)
  if (next.firstFailedAt !== null) {
    let failureMessage =
      'Paid access is unavailable. Open Billing to update payment details.'
    if (effective.paid && next.graceEndsAt !== null) {
      failureMessage = `Update payment details in Billing before paid access ends on ${next.graceEndsAt}.`
    } else if (next.graceEndsAt !== null) {
      failureMessage =
        'Paid access has ended. Open Billing to update payment details and restore access.'
    }
    notices.push({
      key: `failed:${next.subscriptionId}:${next.firstFailedAt}`,
      type: 'payment_failed',
      title: 'Subscription payment failed',
      message: failureMessage
    })
    if (
      effective.paid &&
      effective.reason === 'grace' &&
      next.graceEndsAt !== null &&
      Date.parse(next.graceEndsAt) > Date.parse(now) &&
      Date.parse(next.graceEndsAt) - Date.parse(now) <= 86_400_000
    ) {
      notices.push({
        key: `expiring:${next.subscriptionId}:${next.firstFailedAt}`,
        type: 'grace_expiring',
        title: 'Payment grace expires within 24 hours',
        message: `Paid access ends on ${next.graceEndsAt}. Open Billing to resolve the failed payment.`
      })
    }
  }
  if (
    previous !== null &&
    previous.firstFailedAt !== null &&
    next.paymentVerified &&
    next.firstFailedAt === null &&
    next.lastPaymentAt !== null
  ) {
    notices.push({
      key: `recovered:${next.subscriptionId}:${next.lastPaymentAt}`,
      type: 'payment_recovered',
      title: 'Subscription payment recovered',
      message:
        'Payment succeeded and the subscribed plan is available again. Any administrative suspension remains in effect.'
    })
  }
  return notices
}
