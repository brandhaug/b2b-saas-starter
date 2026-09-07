import { DateTime } from 'effect'
import { type SubscriptionState } from './billing.ts'
import { PLANS, STARTER_PLAN } from './plan-catalog.ts'
import { type StripeSubscriptionResponse } from './stripe.ts'

export type PaymentEvidence = {
  readonly lastPaymentAt: string | null
  readonly firstFailedAt: string | null
  readonly currentInvoicePaid: boolean
}

export type BillingStateDecision =
  | { readonly kind: 'conflict'; readonly reason: string }
  | {
      readonly kind: 'resolved'
      readonly planId: string
      readonly subscription: SubscriptionState
      readonly lifecycleStatus: SubscriptionState['status']
      readonly verified: boolean
    }

export function emptySubscription(customerId: string): SubscriptionState {
  return {
    customerId,
    subscriptionId: null,
    subscriptionItemId: null,
    seatQuantity: 0,
    status: 'canceled',
    subscribedPlanId: 'starter',
    priceId: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    trialEnd: null,
    firstFailedAt: null,
    graceEndsAt: null,
    lastPaymentAt: null,
    paymentVerified: false
  }
}

/** The sole access policy, evaluated both on synchronization and on every read. */
export function effectivePlanDecision(state: SubscriptionState, now: string) {
  const time = Date.parse(now)
  function future(deadline: string | null) {
    return deadline !== null && Date.parse(deadline) > time
  }
  const periodEnded = state.cancelAtPeriodEnd && !future(state.currentPeriodEnd)
  let reason: string = state.status
  let paid = false
  if (!periodEnded) {
    if (state.status === 'active') {
      paid = state.paymentVerified
    }
    if (state.status === 'trialing') {
      paid = future(state.trialEnd)
      if (!paid) {
        reason = 'trial_expired'
      }
    }
    if (
      state.status === 'past_due' &&
      state.lastPaymentAt !== null &&
      future(state.graceEndsAt)
    ) {
      paid = true
      reason = 'grace'
    }
  }
  let planId = STARTER_PLAN.id
  if (paid) {
    planId = state.subscribedPlanId
  }
  return { planId, paid, reason }
}

/** Event fields never grant access: this receives only a verified provider snapshot. */
export function resolveBillingState(input: {
  readonly workspaceId: string
  readonly customerId: string
  readonly subscriptions: ReadonlyArray<StripeSubscriptionResponse>
  readonly hasMore: boolean
  readonly priceIds: Readonly<Record<string, string>>
  readonly previous: SubscriptionState | null
  readonly payment: PaymentEvidence
  readonly now: string
}): BillingStateDecision {
  const current = input.subscriptions.filter(
    (s) => s.status !== 'canceled' && s.status !== 'incomplete_expired'
  )
  if (input.hasMore || current.length > 1) {
    return { kind: 'conflict', reason: 'multiple_subscriptions' }
  }
  const subscription = current[0]
  if (subscription === undefined) {
    return {
      kind: 'resolved',
      planId: 'starter',
      lifecycleStatus: 'canceled',
      verified: true,
      subscription: emptySubscription(input.customerId)
    }
  }
  if (
    subscription.customer !== input.customerId ||
    subscription.metadata?.workspaceId !== input.workspaceId
  ) {
    return { kind: 'conflict', reason: 'subscription_ownership_mismatch' }
  }
  const item = subscription.items.data[0]
  if (
    subscription.items.data.length !== 1 ||
    item === undefined ||
    !Number.isSafeInteger(item.quantity) ||
    item.quantity < 0
  ) {
    return { kind: 'conflict', reason: 'unknown_subscription_item' }
  }
  const recognized = PLANS.filter(
    (plan) => plan.id !== 'starter' && input.priceIds[plan.id] === item.price.id
  )
  const plan = recognized[0]
  if (recognized.length !== 1 || plan === undefined) {
    return { kind: 'conflict', reason: 'unknown_price' }
  }
  let previous: SubscriptionState | null = null
  if (input.previous?.subscriptionId === subscription.id) {
    previous = input.previous
  }
  const lastPaymentAt =
    [input.payment.lastPaymentAt, previous?.lastPaymentAt]
      .filter((at): at is string => at !== null && at !== undefined)
      .toSorted((a, b) => Date.parse(a) - Date.parse(b))
      .at(-1) ?? null
  // Settlements end earlier failure episodes even when a newer invoice is still open.
  const firstFailedAt =
    [previous?.firstFailedAt, input.payment.firstFailedAt]
      .filter(
        (at): at is string =>
          at !== null &&
          at !== undefined &&
          (lastPaymentAt === null || Date.parse(at) > Date.parse(lastPaymentAt))
      )
      .toSorted((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null
  let graceEndsAt: string | null = null
  if (firstFailedAt !== null && lastPaymentAt !== null) {
    graceEndsAt = DateTime.formatIso(
      DateTime.add(DateTime.makeUnsafe(firstFailedAt), { days: 7 })
    )
  }
  let trialEnd: string | null = null
  if (subscription.trial_end !== null) {
    trialEnd = DateTime.formatIso(DateTime.makeUnsafe(subscription.trial_end * 1000))
  }
  const state: SubscriptionState = {
    customerId: input.customerId,
    subscriptionId: subscription.id,
    subscriptionItemId: item.id,
    seatQuantity: item.quantity,
    status: subscription.status,
    subscribedPlanId: plan.id,
    priceId: item.price.id,
    currentPeriodStart: DateTime.formatIso(
      DateTime.makeUnsafe(item.current_period_start * 1000)
    ),
    currentPeriodEnd: DateTime.formatIso(
      DateTime.makeUnsafe(item.current_period_end * 1000)
    ),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    trialEnd,
    firstFailedAt,
    graceEndsAt,
    lastPaymentAt,
    paymentVerified: firstFailedAt === null && lastPaymentAt !== null
  }
  return {
    kind: 'resolved',
    planId: effectivePlanDecision(state, input.now).planId,
    lifecycleStatus: state.status,
    verified: true,
    subscription: state
  }
}
