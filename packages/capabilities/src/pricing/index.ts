import { Context, Effect, Schema } from 'effect'
import { CapabilityUnavailable } from '../errors.ts'
import { BookingPartyId, PricingAdjustmentId, PricingQuoteId } from '../ids.ts'

export const PricingAdjustmentKind = Schema.Literals(['discount', 'tax', 'fee', 'tip'])
export const PricingAdjustment = Schema.Struct({
  id: PricingAdjustmentId,
  kind: PricingAdjustmentKind,
  label: Schema.String,
  amountMinor: Schema.Number,
  allocation: Schema.Record(Schema.String, Schema.Number)
})
export type PricingAdjustment = typeof PricingAdjustment.Type

export const QuoteLine = Schema.Struct({
  requestId: Schema.String,
  holdId: Schema.String,
  serviceIds: Schema.Array(Schema.String),
  amountMinor: Schema.Number
})
export const PricingQuoteFacts = Schema.Struct({
  partyVersion: Schema.Number,
  pricingPolicyVersion: Schema.Number,
  lines: Schema.Array(QuoteLine),
  policyVersions: Schema.Array(Schema.String),
  promotionReservationIds: Schema.Array(Schema.String),
  giftCardReservationIds: Schema.Array(Schema.String)
})
export type PricingQuoteFacts = typeof PricingQuoteFacts.Type

export const PricingQuote = Schema.Struct({
  id: PricingQuoteId,
  bookingPartyId: BookingPartyId,
  version: Schema.Number,
  currency: Schema.String,
  subtotalMinor: Schema.Number,
  adjustmentMinor: Schema.Number,
  tipMinor: Schema.Number,
  totalMinor: Schema.Number,
  facts: PricingQuoteFacts,
  acceptedAt: Schema.NullOr(Schema.String),
  expiresAt: Schema.String,
  adjustments: Schema.Array(PricingAdjustment)
})
export type PricingQuote = typeof PricingQuote.Type

export const QuoteMaterial = Schema.Struct({
  bookingPartyId: BookingPartyId,
  partyVersion: Schema.Number,
  currency: Schema.String,
  lines: Schema.Array(QuoteLine),
  policyVersions: Schema.Array(Schema.String),
  promotionCode: Schema.optional(Schema.String),
  giftCardReservationIds: Schema.Array(Schema.String),
  tipMinor: Schema.Number,
  expiresAt: Schema.String,
  now: Schema.String
})
export type QuoteMaterial = typeof QuoteMaterial.Type

export const Promotion = Schema.Struct({
  id: Schema.String,
  code: Schema.String,
  label: Schema.String,
  currency: Schema.String,
  kind: Schema.Literals(['fixed', 'percentage']),
  value: Schema.Number,
  minimumSubtotalMinor: Schema.Number,
  maximumUses: Schema.NullOr(Schema.Number),
  startsAt: Schema.String,
  expiresAt: Schema.String
})
export type Promotion = typeof Promotion.Type

export const QuoteRecovery = Schema.Literals(['stale', 'superseded', 'expired'])
export type QuoteRecovery = typeof QuoteRecovery.Type

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
  { quoteId: Schema.String, reason: QuoteRecovery }
) {}
export class PricingQuoteNotFound extends Schema.TaggedErrorClass<PricingQuoteNotFound>()(
  'PricingQuoteNotFound',
  { bookingPartyId: BookingPartyId }
) {}
export class InvalidQuoteMaterial extends Schema.TaggedErrorClass<InvalidQuoteMaterial>()(
  'InvalidQuoteMaterial',
  { reason: Schema.String }
) {}
export class PromotionUnavailable extends Schema.TaggedErrorClass<PromotionUnavailable>()(
  'PromotionUnavailable',
  { code: Schema.String, reason: Schema.String }
) {}

export type PricingError =
  | PricingQuoteNotFound
  | InvalidQuoteMaterial
  | PromotionUnavailable
  | QuoteUnconfirmable
  | CapabilityUnavailable

export type PricingQuotesShape = {
  readonly quote: (material: QuoteMaterial) => Effect.Effect<PricingQuote, PricingError>
  readonly accept: (
    quoteId: string,
    partyVersion: number,
    now: string
  ) => Effect.Effect<PricingQuote, PricingError>
  readonly requireAccepted: (
    quoteId: string,
    partyVersion: number,
    now: string
  ) => Effect.Effect<PricingQuote, PricingError>
  readonly commitPromotionReservations: (
    quoteId: string
  ) => Effect.Effect<void, PricingError>
  readonly releasePromotionReservations: (
    quoteId: string
  ) => Effect.Effect<void, PricingError>
  readonly findLatest: (
    bookingPartyId: string
  ) => Effect.Effect<PricingQuote, PricingQuoteNotFound | CapabilityUnavailable>
}

export class PricingQuotes extends Context.Service<PricingQuotes, PricingQuotesShape>()(
  '@b2b-saas-starter/capabilities/PricingQuotes'
) {}

export const allocateMinor = (
  amountMinor: number,
  lines: readonly { readonly requestId: string; readonly amountMinor: number }[]
): Record<string, number> => {
  if (amountMinor === 0)
    return Object.fromEntries(lines.map((line) => [line.requestId, 0]))
  const subtotal = lines.reduce((sum, line) => sum + line.amountMinor, 0)
  if (subtotal <= 0) return {}
  const sign = Math.sign(amountMinor)
  const absolute = Math.abs(amountMinor)
  const ranked = lines.map((line, index) => {
    const numerator = absolute * line.amountMinor
    return {
      requestId: line.requestId,
      index,
      share: Math.floor(numerator / subtotal),
      remainder: numerator % subtotal
    }
  })
  let remaining = absolute - ranked.reduce((sum, line) => sum + line.share, 0)
  for (const line of [...ranked].sort(
    (a, b) => b.remainder - a.remainder || a.index - b.index
  )) {
    if (remaining-- <= 0) break
    line.share++
  }
  return Object.fromEntries(ranked.map((line) => [line.requestId, line.share * sign]))
}
