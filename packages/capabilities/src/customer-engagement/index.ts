import { Context, Effect, Schema } from 'effect'
import { CapabilityUnavailable } from '../errors.ts'
import { WaitingListApplicationId } from '../ids.ts'

export const WaitingListLifecycle = Schema.Literals([
  'active',
  'fulfilled',
  'withdrawn',
  'expired'
])
export const AvailabilityOfferLifecycle = Schema.Literals([
  'pending',
  'accepted',
  'declined',
  'expired',
  'superseded'
])
export const WalkInLifecycle = Schema.Literals([
  'waiting',
  'called',
  'serving',
  'served',
  'removed',
  'expired'
])
export const PolicyAcceptance = Schema.Struct({
  id: Schema.String,
  bookingPartyId: Schema.String,
  checkoutPolicyId: Schema.String,
  disclosureSnapshot: Schema.String,
  acceptedAt: Schema.String
})
export class OfferUnavailable extends Schema.TaggedErrorClass<OfferUnavailable>()(
  'OfferUnavailable',
  { offerId: Schema.String }
) {}

export const WaitingListApplication = Schema.Struct({
  id: WaitingListApplicationId,
  shopId: Schema.String,
  status: WaitingListLifecycle,
  expiresAt: Schema.String
})

export class WaitingListApplicationNotFound extends Schema.TaggedErrorClass<WaitingListApplicationNotFound>()(
  'WaitingListApplicationNotFound',
  { applicationId: WaitingListApplicationId }
) {}

export type CustomerEngagementShape = {
  readonly findWaitingListApplication: (
    applicationId: string
  ) => Effect.Effect<
    typeof WaitingListApplication.Type,
    WaitingListApplicationNotFound | CapabilityUnavailable
  >
}

export class CustomerEngagement extends Context.Service<
  CustomerEngagement,
  CustomerEngagementShape
>()('@b2b-saas-starter/capabilities/CustomerEngagement') {}
