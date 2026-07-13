import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  GiftCardRedemptions,
  SeedGiftCardRedemptions,
  emptySeedGiftCardRedemptionStore
} from './gift-card-redemption.ts'

const now = '2026-07-13T10:00:00.000Z'
const expiresAt = '2026-07-13T10:15:00.000Z'

const makeStore = () =>
  emptySeedGiftCardRedemptionStore({
    cards: [
      {
        id: 'gcd_shop',
        codeHash: 'b37e7af30ae87ed09814c5a864465fd16e52d72fec8fcf69abc73edae729badc',
        status: 'active',
        currency: 'USD',
        scope: 'shop',
        scopeId: 'shp_demo',
        expiresAt: null,
        initialValueMinor: 10_000
      },
      {
        id: 'gcd_provider',
        codeHash: '96dc3b9b584e070aca208baa0e9624b17442f150c35fcc3cca05085d266a09f4',
        status: 'active',
        currency: 'USD',
        scope: 'provider',
        scopeId: 'prv_demo',
        expiresAt: null,
        initialValueMinor: 5_000
      }
    ],
    ledger: [
      {
        id: 'gcl_issuance',
        giftCardId: 'gcd_shop',
        bookingPartyId: null,
        kind: 'issuance',
        amountMinor: 10_000,
        idempotencyKey: 'issuance:gcd_shop',
        occurredAt: now
      },
      {
        id: 'gcl_provider_issuance',
        giftCardId: 'gcd_provider',
        bookingPartyId: null,
        kind: 'issuance',
        amountMinor: 5_000,
        idempotencyKey: 'issuance:gcd_provider',
        occurredAt: now
      }
    ],
    eligibleScopes: [
      [
        'bpt_demo',
        {
          merchantId: 'mer_demo',
          brandId: 'brd_demo',
          shopId: 'shp_demo',
          providerIds: ['prv_demo']
        }
      ],
      [
        'bpt_one',
        {
          merchantId: 'mer_demo',
          brandId: 'brd_demo',
          shopId: 'shp_demo',
          providerIds: ['prv_demo']
        }
      ],
      [
        'bpt_two',
        {
          merchantId: 'mer_demo',
          brandId: 'brd_demo',
          shopId: 'shp_demo',
          providerIds: ['prv_demo']
        }
      ]
    ]
  })

describe('Gift Card redemption', () => {
  it('reserves value once and plans full, partial, and mixed settlement without repricing', async () => {
    const store = makeStore()
    const run = <A>(effect: Effect.Effect<A, unknown, GiftCardRedemptions>) =>
      Effect.runPromise(effect.pipe(Effect.provide(SeedGiftCardRedemptions(store))))
    const reserve = (amountMinor: number, idempotencyKey: string) =>
      run(
        Effect.flatMap(GiftCardRedemptions, (cards) =>
          cards.reserve({
            giftCardCode: 'shop-code',
            bookingPartyId: 'bpt_demo',
            amountMinor,
            maximumAmountMinor: 10_000,
            expiresAt,
            idempotencyKey,
            now
          })
        )
      )

    const first = await reserve(6_000, 'reserve-1')
    expect(await reserve(6_000, 'reserve-1')).toEqual(first)
    expect(
      await run(
        Effect.flatMap(GiftCardRedemptions, (cards) => cards.balance('gcd_shop'))
      )
    ).toEqual({
      giftCardId: 'gcd_shop',
      currency: 'USD',
      availableMinor: 4_000
    })
    await expect(reserve(4_001, 'reserve-2')).rejects.toMatchObject({
      code: 'reservation_exceeds_quote'
    })

    const mixed = await run(
      Effect.flatMap(GiftCardRedemptions, (cards) =>
        cards.planSettlement({
          bookingPartyId: 'bpt_demo',
          quoteTotalMinor: 10_000,
          currency: 'USD',
          now
        })
      )
    )
    expect(mixed).toMatchObject({
      quoteTotalMinor: 10_000,
      giftCardMinor: 6_000,
      externalPaymentMinor: 4_000
    })
    expect(mixed.allocations).toEqual([
      {
        tender: 'gift_card',
        referenceId: 'gcd_shop',
        reservationId: first.id,
        amountMinor: 6_000,
        currency: 'USD'
      }
    ])
  })

  it('rejects invalid currency, scope, status, expiry, and concurrent overspend', async () => {
    const store = makeStore()
    const run = <A>(effect: Effect.Effect<A, unknown, GiftCardRedemptions>) =>
      Effect.runPromise(effect.pipe(Effect.provide(SeedGiftCardRedemptions(store))))
    const reserve = (overrides: Record<string, unknown> = {}) =>
      run(
        Effect.flatMap(GiftCardRedemptions, (cards) =>
          cards.reserve({
            giftCardCode: 'shop-code',
            bookingPartyId: 'bpt_demo',
            amountMinor: 7_000,
            maximumAmountMinor: 10_000,
            expiresAt,
            idempotencyKey: 'reserve-default',
            now,
            ...overrides
          })
        )
      )

    await expect(reserve({ giftCardCode: 'wrong-code' })).rejects.toMatchObject({
      code: 'gift_card_not_found'
    })
    store.eligibleScopes.set('bpt_demo', {
      merchantId: 'mer_demo',
      brandId: 'brd_demo',
      shopId: 'shp_other',
      providerIds: ['prv_demo']
    })
    await expect(reserve()).rejects.toMatchObject({
      code: 'scope_mismatch'
    })
    store.eligibleScopes.set('bpt_demo', {
      merchantId: 'mer_demo',
      brandId: 'brd_demo',
      shopId: 'shp_demo',
      providerIds: ['prv_demo']
    })
    store.eligibleScopes.set('bpt_demo', {
      merchantId: 'mer_demo',
      brandId: 'brd_demo',
      shopId: 'shp_demo',
      providerIds: ['prv_demo', 'prv_other']
    })
    await expect(
      reserve({ giftCardCode: 'provider-code', amountMinor: 1000 })
    ).rejects.toMatchObject({ code: 'scope_mismatch' })
    const outcomes = await Promise.allSettled([
      reserve({ bookingPartyId: 'bpt_one', idempotencyKey: 'reserve-one' }),
      reserve({ bookingPartyId: 'bpt_two', idempotencyKey: 'reserve-two' })
    ])
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
  })

  it('releases expired reservations and caps refunds at the original allocations', async () => {
    const store = makeStore()
    const run = <A>(effect: Effect.Effect<A, unknown, GiftCardRedemptions>) =>
      Effect.runPromise(effect.pipe(Effect.provide(SeedGiftCardRedemptions(store))))
    const cards = await Effect.runPromise(
      Effect.flatMap(GiftCardRedemptions, Effect.succeed).pipe(
        Effect.provide(SeedGiftCardRedemptions(store))
      )
    )
    await run(
      cards.reserve({
        giftCardCode: 'shop-code',
        bookingPartyId: 'bpt_demo',
        amountMinor: 6_000,
        maximumAmountMinor: 10_000,
        expiresAt,
        idempotencyKey: 'reserve-1',
        now
      })
    )
    expect(await run(cards.releaseExpired({ now: expiresAt }))).toBe(1)
    expect((await run(cards.balance('gcd_shop'))).availableMinor).toBe(10_000)

    store.settlementPlans.set('bpt_confirmed', {
      bookingPartyId: 'bpt_confirmed',
      quoteTotalMinor: 9_000,
      giftCardMinor: 4_000,
      externalPaymentMinor: 5_000,
      currency: 'USD',
      allocations: [
        {
          tender: 'gift_card',
          referenceId: 'gcd_shop',
          reservationId: 'gcr_confirmed',
          amountMinor: 4_000,
          currency: 'USD'
        },
        {
          tender: 'external_payment',
          referenceId: 'pay_demo',
          reservationId: null,
          amountMinor: 5_000,
          currency: 'USD'
        }
      ]
    })

    const refund = () =>
      run(
        cards.refund({
          bookingPartyId: 'bpt_confirmed',
          idempotencyKey: 'refund:bpt_confirmed',
          now: '2026-07-14T10:00:00.000Z'
        })
      )
    expect(await refund()).toEqual({
      bookingPartyId: 'bpt_confirmed',
      restoredGiftCardMinor: 4_000,
      externalPaymentMinor: 5_000,
      currency: 'USD'
    })
    expect(await refund()).toEqual(await refund())
    await expect(
      run(
        cards.refund({
          bookingPartyId: 'bpt_confirmed',
          idempotencyKey: 'refund:bpt_confirmed:second',
          now: '2026-07-14T10:01:00.000Z'
        })
      )
    ).rejects.toMatchObject({ code: 'settlement_already_refunded' })
  })
})
