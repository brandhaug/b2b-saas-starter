import { Context, Effect, Schema } from 'effect'
import { CapabilityUnavailable } from '../errors.ts'
import { GiftCardId, GiftCardProductId } from '../ids.ts'

export const GiftCardProduct = Schema.Struct({
  id: GiftCardProductId,
  name: Schema.String,
  currency: Schema.String,
  scope: Schema.Literals(['merchant', 'brand', 'shop', 'provider']),
  scopeId: Schema.String,
  active: Schema.Boolean
})
export const GiftCard = Schema.Struct({
  id: GiftCardId,
  status: Schema.Literals(['active', 'suspended', 'expired', 'voided']),
  currency: Schema.String,
  scope: Schema.Literals(['merchant', 'brand', 'shop', 'provider']),
  scopeId: Schema.String,
  initialValueMinor: Schema.Number
})
export class GiftCardNotFound extends Schema.TaggedErrorClass<GiftCardNotFound>()(
  'GiftCardNotFound',
  { giftCardId: GiftCardId }
) {}
export type GiftCardsShape = {
  readonly findById: (
    giftCardId: string
  ) => Effect.Effect<typeof GiftCard.Type, GiftCardNotFound | CapabilityUnavailable>
}
export class GiftCards extends Context.Service<GiftCards, GiftCardsShape>()(
  '@b2b-saas-starter/capabilities/GiftCards'
) {}

export {
  GiftCardPerson,
  GiftCardSale,
  IssuedGiftCard,
  GiftCardSaleConflict,
  GiftCardPayment,
  GiftCardSales,
  hashGiftCardReceiptToken,
  purchaseAndIssueGiftCard,
  sortGiftCardProducts,
  giftCardAmountIsPermitted
} from './gift-card-sales.ts'
export type {
  GiftCardReceipt,
  GiftCardReceiptState,
  GiftCardPurchaseResult,
  GiftCardPaymentShape,
  GiftCardSalesShape,
  GiftCardProductOffer
} from './gift-card-sales.ts'
export {
  GiftCardRedemptionConflict,
  GiftCardRedemptions,
  SeedGiftCardRedemptions,
  emptySeedGiftCardRedemptionStore,
  hashGiftCardRedemptionCode
} from './gift-card-redemption.ts'
export type {
  GiftCardLedgerEntry,
  GiftCardReservation,
  GiftCardSettlementPlan,
  GiftCardRedemptionsShape,
  RedeemableGiftCard,
  SeedGiftCardRedemptionStore,
  GiftCardSettlementAllocation
} from './gift-card-redemption.ts'
