import { Schema } from 'effect'
import { SubscriptionState } from './billing.ts'

/** Column aliases are normalized once, then the persisted lifecycle is decoded. */
export const decodeSubscriptionRow = Schema.decodeUnknownEffect(
  SubscriptionState.pipe(
    Schema.encodeKeys({
      customerId: 'stripeCustomerId',
      subscriptionId: 'stripeSubscriptionId',
      subscriptionItemId: 'stripeSubscriptionItemId',
      priceId: 'stripePriceId'
    })
  )
)
