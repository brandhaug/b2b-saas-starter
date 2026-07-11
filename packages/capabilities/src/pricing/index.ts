import { Context, Effect, Schema } from 'effect'
import { CapabilityUnavailable } from '../errors.ts'
import { BookingPartyId, PricingAdjustmentId, PricingQuoteId } from '../ids.ts'

export const PricingAdjustment = Schema.Struct({
  id: PricingAdjustmentId,
  kind: Schema.String,
  label: Schema.String,
  amountMinor: Schema.Number,
  allocation: Schema.Record(Schema.String, Schema.Number)
})
export const PricingQuote = Schema.Struct({
  id: PricingQuoteId,
  bookingPartyId: BookingPartyId,
  version: Schema.Number,
  currency: Schema.String,
  subtotalMinor: Schema.Number,
  adjustmentMinor: Schema.Number,
  tipMinor: Schema.Number,
  totalMinor: Schema.Number,
  facts: Schema.Unknown,
  acceptedAt: Schema.NullOr(Schema.String),
  expiresAt: Schema.String,
  adjustments: Schema.Array(PricingAdjustment)
})
export const SettlementAllocation = Schema.Struct({
  id: Schema.String,
  bookingPartyId: Schema.String,
  tender: Schema.Literals(['gift_card', 'external_payment', 'pay_in_person']),
  referenceId: Schema.NullOr(Schema.String),
  amountMinor: Schema.Number,
  currency: Schema.String
})
export class QuoteUnconfirmable extends Schema.TaggedErrorClass<QuoteUnconfirmable>()(
  'QuoteUnconfirmable',
  { quoteId: Schema.String, reason: Schema.String }
) {}

export class PricingQuoteNotFound extends Schema.TaggedErrorClass<PricingQuoteNotFound>()(
  'PricingQuoteNotFound',
  { bookingPartyId: BookingPartyId }
) {}

export type PricingQuotesShape = {
  readonly findLatest: (
    bookingPartyId: string
  ) => Effect.Effect<
    typeof PricingQuote.Type,
    PricingQuoteNotFound | CapabilityUnavailable
  >
}

export class PricingQuotes extends Context.Service<PricingQuotes, PricingQuotesShape>()(
  '@b2b-saas-starter/capabilities/PricingQuotes'
) {}
