import { Effect, Layer } from 'effect'
import { desc, eq } from 'drizzle-orm'
import { Database, pricingAdjustments, pricingQuotes } from '@b2b-saas-starter/db'
import { orUnavailable } from '../internal/unavailable.ts'
import { PricingQuoteNotFound, PricingQuotes } from './index.ts'

export const SeedPricingQuotes = (
  records: readonly (typeof import('./index.ts').PricingQuote.Type)[] = []
): Layer.Layer<PricingQuotes> =>
  Layer.succeed(PricingQuotes)({
    findLatest: (bookingPartyId) => {
      const quote = records
        .filter((record) => record.bookingPartyId === bookingPartyId)
        .sort((left, right) => right.version - left.version)[0]
      return quote
        ? Effect.succeed(quote)
        : Effect.fail(new PricingQuoteNotFound({ bookingPartyId }))
    }
  })

export const LivePricingQuotes: Layer.Layer<PricingQuotes, never, Database> =
  Layer.effect(
    PricingQuotes,
    Effect.gen(function* () {
      const db = yield* Database
      return {
        findLatest: (bookingPartyId) =>
          Effect.gen(function* () {
            const [quote] = yield* orUnavailable('pricing-quotes')(
              db
                .select()
                .from(pricingQuotes)
                .where(eq(pricingQuotes.bookingPartyId, bookingPartyId))
                .orderBy(desc(pricingQuotes.version))
                .limit(1)
            )
            if (!quote) return yield* new PricingQuoteNotFound({ bookingPartyId })
            const adjustments = yield* orUnavailable('pricing-quotes')(
              db
                .select()
                .from(pricingAdjustments)
                .where(eq(pricingAdjustments.pricingQuoteId, quote.id))
            )
            return {
              id: quote.id,
              bookingPartyId: quote.bookingPartyId,
              version: quote.version,
              currency: quote.currency,
              subtotalMinor: quote.subtotalMinor,
              adjustmentMinor: quote.adjustmentMinor,
              tipMinor: quote.tipMinor,
              totalMinor: quote.totalMinor,
              facts: JSON.parse(quote.factsJson) as unknown,
              acceptedAt: quote.acceptedAt,
              expiresAt: quote.expiresAt,
              adjustments: adjustments.map((adjustment) => ({
                id: adjustment.id,
                kind: adjustment.kind,
                label: adjustment.label,
                amountMinor: adjustment.amountMinor,
                allocation: JSON.parse(adjustment.allocationJson) as Record<
                  string,
                  number
                >
              }))
            }
          })
      }
    })
  )
