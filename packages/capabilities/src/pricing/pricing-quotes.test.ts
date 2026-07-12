import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { SeedPricingQuotes } from './adapters.ts'
import {
  allocateMinor,
  PricingQuotes,
  type Promotion,
  type QuoteMaterial
} from './index.ts'

const now = '2026-07-12T10:00:00.000Z'
const material = (overrides: Partial<QuoteMaterial> = {}): QuoteMaterial => ({
  bookingPartyId: 'bpt_group',
  partyVersion: 3,
  currency: 'RON',
  lines: [
    {
      requestId: 'brq_one',
      holdId: 'hld_one',
      serviceIds: ['svc_one'],
      amountMinor: 1000
    },
    {
      requestId: 'brq_two',
      holdId: 'hld_two',
      serviceIds: ['svc_two'],
      amountMinor: 2000
    }
  ],
  policyVersions: ['checkout:v2'],
  giftCardReservationIds: ['gcr_one'],
  tipMinor: 300,
  expiresAt: '2026-07-12T10:15:00.000Z',
  now,
  ...overrides
})
const limited: Promotion = {
  id: 'prm_summer',
  code: 'SUMMER',
  label: 'Summer offer',
  currency: 'RON',
  kind: 'percentage',
  value: 1000,
  minimumSubtotalMinor: 1000,
  maximumUses: 1,
  startsAt: '2026-07-01T00:00:00.000Z',
  expiresAt: '2026-08-01T00:00:00.000Z'
}

describe('Pricing Quotes', () => {
  it('creates an immutable single-currency version with deterministic named allocations', async () => {
    const quote = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(PricingQuotes, (pricing) =>
          pricing.quote(material({ promotionCode: 'summer' }))
        ),
        SeedPricingQuotes([], [limited], {
          taxBasisPoints: 1000,
          feeMinor: 90,
          taxLabel: 'VAT',
          feeLabel: 'Booking fee'
        })
      )
    )
    expect(quote).toMatchObject({
      version: 1,
      currency: 'RON',
      subtotalMinor: 3000,
      adjustmentMinor: 360,
      tipMinor: 300,
      totalMinor: 3360,
      acceptedAt: null,
      facts: {
        partyVersion: 3,
        policyVersions: ['checkout:v2'],
        giftCardReservationIds: ['gcr_one']
      }
    })
    expect(
      quote.adjustments.map(({ kind, label, amountMinor, allocation }) => ({
        kind,
        label,
        amountMinor,
        allocation
      }))
    ).toEqual([
      {
        kind: 'discount',
        label: 'Summer offer',
        amountMinor: -300,
        allocation: { brq_one: -100, brq_two: -200 }
      },
      {
        kind: 'tax',
        label: 'VAT',
        amountMinor: 270,
        allocation: { brq_one: 90, brq_two: 180 }
      },
      {
        kind: 'fee',
        label: 'Booking fee',
        amountMinor: 90,
        allocation: { brq_one: 30, brq_two: 60 }
      },
      {
        kind: 'tip',
        label: 'Tip',
        amountMinor: 300,
        allocation: { brq_one: 100, brq_two: 200 }
      }
    ])
    expect(quote.facts.promotionReservationIds).toHaveLength(1)
  })

  it('accepts only the latest unexpired version bound to the current party material', async () => {
    const layer = SeedPricingQuotes()
    const superseded = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const pricing = yield* PricingQuotes
          const first = yield* pricing.quote(material())
          yield* pricing.quote(material({ tipMinor: 0 }))
          return yield* Effect.flip(pricing.accept(first.id, 3, now))
        }),
        layer
      )
    )
    expect(superseded).toMatchObject({
      _tag: 'QuoteUnconfirmable',
      reason: 'superseded'
    })
  })

  it('makes an accepted quote unconfirmable after party change or expiry', async () => {
    const layer = SeedPricingQuotes()
    const { stale, expired } = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const pricing = yield* PricingQuotes
          const quote = yield* pricing.quote(material())
          yield* pricing.accept(quote.id, 3, now)
          const stale = yield* Effect.flip(pricing.requireAccepted(quote.id, 4, now))
          const expired = yield* Effect.flip(
            pricing.requireAccepted(quote.id, 3, quote.expiresAt)
          )
          return { stale, expired }
        }),
        layer
      )
    )
    expect(stale).toMatchObject({ reason: 'stale' })
    expect(expired).toMatchObject({ reason: 'expired' })
  })

  it('atomically reserves a limited promotion for at most one concurrent quote', async () => {
    const layer = SeedPricingQuotes([], [limited])
    const results = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const pricing = yield* PricingQuotes
          const attempt = (party: string) =>
            Effect.result(
              pricing.quote(
                material({ bookingPartyId: party, promotionCode: 'SUMMER' })
              )
            )
          return yield* Effect.all([attempt('bpt_one'), attempt('bpt_two')], {
            concurrency: 'unbounded'
          })
        }),
        layer
      )
    )
    expect(results.filter((result) => result._tag === 'Success')).toHaveLength(1)
    expect(results.filter((result) => result._tag === 'Failure')).toHaveLength(1)
  })

  it('allocates indivisible minor units deterministically and preserves the total', () => {
    const allocation = allocateMinor(-2, [
      { requestId: 'brq_a', amountMinor: 1 },
      { requestId: 'brq_b', amountMinor: 1 },
      { requestId: 'brq_c', amountMinor: 1 }
    ])
    expect(allocation).toEqual({ brq_a: -1, brq_b: -1, brq_c: -0 })
    expect(Object.values(allocation).reduce((sum, amount) => sum + amount, 0)).toBe(-2)
  })
})
