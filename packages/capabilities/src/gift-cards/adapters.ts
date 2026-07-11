import { Effect, Layer } from 'effect'
import { eq } from 'drizzle-orm'
import { Database, giftCards } from '@b2b-saas-starter/db'
import { orUnavailable } from '../internal/unavailable.ts'
import { GiftCardNotFound, GiftCards } from './index.ts'

type GiftCard = typeof import('./index.ts').GiftCard.Type
export const SeedGiftCards = (
  records: readonly GiftCard[] = []
): Layer.Layer<GiftCards> =>
  Layer.succeed(GiftCards)({
    findById: (giftCardId) => {
      const card = records.find((record) => record.id === giftCardId)
      return card
        ? Effect.succeed(card)
        : Effect.fail(new GiftCardNotFound({ giftCardId }))
    }
  })
export const LiveGiftCards: Layer.Layer<GiftCards, never, Database> = Layer.effect(
  GiftCards,
  Effect.gen(function* () {
    const db = yield* Database
    return {
      findById: (giftCardId) =>
        Effect.flatMap(
          orUnavailable('gift-cards')(
            db.select().from(giftCards).where(eq(giftCards.id, giftCardId)).limit(1)
          ),
          ([card]) =>
            card
              ? Effect.succeed({
                  id: card.id,
                  status: card.status,
                  currency: card.currency,
                  scope: card.scope,
                  scopeId: card.scopeId,
                  initialValueMinor: card.initialValueMinor
                })
              : Effect.fail(new GiftCardNotFound({ giftCardId }))
        )
    }
  })
)
