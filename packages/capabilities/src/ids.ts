import { Schema } from 'effect'

const stableId = (prefix: string) =>
  Schema.String.check(Schema.isPattern(new RegExp(`^${prefix}_[A-Za-z0-9_-]+$`)))

export const BrandId = stableId('brd')
export const ShopId = stableId('shp')
export const BookingPartyId = stableId('bpt')
export const BookingRequestId = stableId('brq')
export const PricingQuoteId = stableId('pqt')
export const PricingAdjustmentId = stableId('pad')
export const PaymentId = stableId('pay')
export const GiftCardId = stableId('gcd')
export const GiftCardProductId = stableId('gcp')
export const CustomerAccountId = stableId('cua')
export const WaitingListApplicationId = stableId('wla')
export const AvailabilityOfferId = stableId('avo')
export const WalkInEntryId = stableId('wie')
export const NotificationIntentId = stableId('nti')
export const ScheduledWorkId = stableId('swk')
