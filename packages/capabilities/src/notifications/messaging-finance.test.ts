import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { SeedMessagingFinance } from './messaging-finance.ts'
import { MessagingFinance } from './index.ts'

const now = '2026-07-29T12:00:00.000Z'

describe('Seed Messaging Finance', () => {
  it('matches the exact reservation, conversion, and correction contract', async () => {
    const layer = SeedMessagingFinance({
      intents: [
        {
          id: 'nti_seed_finance',
          shopId: 'shp_seed_finance',
          createdAt: now,
          rateCardId: 'mrcard_launch_v1'
        }
      ],
      routes: [
        {
          id: 'drt_seed_finance',
          shopId: 'shp_seed_finance',
          intentId: 'nti_seed_finance',
          verifiedDelivered: true
        }
      ]
    })
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const finance = yield* MessagingFinance
        yield* finance.credit({
          shopId: 'shp_seed_finance',
          kind: 'top_up',
          amountMilliEuro: 10_000,
          sourceType: 'stripe_payment',
          sourceId: 'pi_seed_finance',
          idempotencyKey: 'stripe:seed:finance',
          fiscalReference: 'invoice:seed:finance',
          occurredAt: now
        })
        yield* finance.reserve({
          shopId: 'shp_seed_finance',
          intentId: 'nti_seed_finance',
          expiresAt: '2026-08-05T12:00:00.000Z',
          reservedAt: now
        })
        const delivery = yield* finance.convertDelivery({
          shopId: 'shp_seed_finance',
          intentId: 'nti_seed_finance',
          routeId: 'drt_seed_finance',
          verifiedAt: now
        })
        const charge = (yield* finance.statement('shp_seed_finance')).find(
          (entry) => entry.kind === 'delivery_charge'
        )!
        yield* finance.correct({
          shopId: 'shp_seed_finance',
          entryId: charge.id,
          correctionReason: 'invalidated_delivery_evidence',
          sourceType: 'reconciliation',
          sourceId: 'case_seed_finance',
          idempotencyKey: 'case:seed:finance',
          actorType: 'system',
          actorId: 'messaging-reconciliation',
          reason: 'Invalidate delivery evidence',
          occurredAt: now
        })
        return {
          delivery,
          balance: yield* finance.balance('shp_seed_finance'),
          statement: yield* finance.statement('shp_seed_finance')
        }
      }).pipe(Effect.provide(layer))
    )

    expect(result.delivery.chargeMilliEuro).toBe(45)
    expect(result.balance.availableMilliEuro).toBe(10_000)
    expect(result.statement.map((entry) => entry.kind)).toEqual([
      'top_up',
      'delivery_charge',
      'correction'
    ])
  })
})
