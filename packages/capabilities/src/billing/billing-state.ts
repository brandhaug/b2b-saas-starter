import { type SubscriptionState } from './billing.ts'
import { PLANS, STARTER_PLAN } from './plan-catalog.ts'
import { type StripeSubscriptionResponse } from './stripe.ts'

export type BillingStateDecision =
  | { readonly kind: 'conflict'; readonly reason: string }
  | {
      readonly kind: 'resolved'
      readonly planId: string
      readonly subscription: SubscriptionState
      readonly lifecycleStatus: string
      readonly verified: boolean
    }

/** Shared provider-state policy; event arrival order never selects an entitlement. */
export function resolveBillingState(input: {
  readonly workspaceId: string
  readonly customerId: string
  readonly subscriptions: ReadonlyArray<StripeSubscriptionResponse>
  readonly hasMore: boolean
  readonly priceIds: Readonly<Record<string, string>>
  readonly currentPlanId: string
}): BillingStateDecision {
  const current = input.subscriptions.filter(
    (subscription) =>
      subscription.status !== 'canceled' && subscription.status !== 'incomplete_expired'
  )
  if (input.hasMore || current.length > 1) {
    return { kind: 'conflict', reason: 'multiple_subscriptions' }
  }
  const subscription = current[0]
  if (subscription === undefined) {
    return {
      kind: 'resolved',
      planId: STARTER_PLAN.id,
      lifecycleStatus: 'canceled',
      verified: true,
      subscription: {
        customerId: input.customerId,
        subscriptionId: null,
        subscriptionItemId: null,
        seatQuantity: 0
      }
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
    item?.price === undefined ||
    item.quantity === undefined ||
    !Number.isSafeInteger(item.quantity) ||
    item.quantity < 0
  ) {
    return { kind: 'conflict', reason: 'unknown_subscription_item' }
  }
  const recognized = PLANS.filter((plan) => input.priceIds[plan.id] === item.price?.id)
  const plan = recognized[0]
  if (recognized.length !== 1 || plan === undefined) {
    return { kind: 'conflict', reason: 'unknown_price' }
  }
  // #284 owns further payment/access transitions. Until then only verified
  // active/trialing subscriptions can change the entitlement; other states
  // preserve the previous plan and remain visibly pending.
  const verified =
    subscription.status === 'active' || subscription.status === 'trialing'
  let planId = input.currentPlanId
  if (verified) {
    planId = plan.id
  }
  return {
    kind: 'resolved',
    planId,
    lifecycleStatus: subscription.status,
    verified,
    subscription: {
      customerId: input.customerId,
      subscriptionId: subscription.id,
      subscriptionItemId: item.id,
      seatQuantity: item.quantity
    }
  }
}
