import { Effect } from 'effect'
import { MerchantSubscriptions } from '../subscriptions/merchant-subscriptions.ts'

export type SubscriptionRefundDecision = {
  readonly eventId: string
  readonly consequence?: 'end-access' | 'courtesy-preserve-access' | undefined
  readonly shortenedPeriodEndsAt?: string | undefined
}

/** Operations-owned staff workflow over retained, signed provider evidence. */
export const decideSubscriptionRefund = (input: SubscriptionRefundDecision) =>
  Effect.flatMap(MerchantSubscriptions, (subscriptions) =>
    subscriptions.decideSupportRefund(input)
  )
