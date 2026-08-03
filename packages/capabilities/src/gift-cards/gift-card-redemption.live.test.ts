import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { layerFromD1 } from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { LiveGiftCardRedemptions, LiveGiftCardSales } from './adapters.ts'
import { GiftCardRedemptions } from './gift-card-redemption.ts'
import { GiftCardSales } from './gift-card-sales.ts'

let test: TestD1
const now = '2026-07-13T10:00:00.000Z'

beforeAll(async () => {
  test = await provisionTestD1()
  for (const statement of [
    `INSERT INTO merchants (id, public_name, slug, timezone, currency, plan, created_at, updated_at) VALUES ('mrc_redeem', 'Redeem Shop', 'redeem-shop', 'UTC', 'USD', 'solo', '${now}', '${now}')`,
    `INSERT INTO brands (id, merchant_id, name, created_at, updated_at) VALUES ('brd_redeem', 'mrc_redeem', 'Redeem Shop', '${now}', '${now}')`,
    `INSERT INTO shops (id, brand_id, merchant_id, slug, public_name, timezone, currency, created_at, updated_at) VALUES ('shp_redeem', 'brd_redeem', 'mrc_redeem', 'downtown-redeem', 'Redeem Shop', 'UTC', 'USD', '${now}', '${now}')`,
    `INSERT INTO booking_sessions (id, merchant_id, capability_hash, checkout_path, lifecycle, created_at, last_activity_at, idle_expires_at, absolute_expires_at) VALUES ('bsn_redeem_one', 'mrc_redeem', 'hash-one', 'pay_in_person', 'active', '${now}', '${now}', '2026-07-13T12:00:00.000Z', '2026-07-13T13:00:00.000Z')`,
    `INSERT INTO booking_sessions (id, merchant_id, capability_hash, checkout_path, lifecycle, created_at, last_activity_at, idle_expires_at, absolute_expires_at) VALUES ('bsn_redeem_two', 'mrc_redeem', 'hash-two', 'pay_in_person', 'active', '${now}', '${now}', '2026-07-13T12:00:00.000Z', '2026-07-13T13:00:00.000Z')`,
    `INSERT INTO booking_parties (id, booking_session_id, shop_id, lifecycle, currency, locale, version, created_at, updated_at) VALUES ('bpt_redeem_one', 'bsn_redeem_one', 'shp_redeem', 'active', 'USD', 'en', 1, '${now}', '${now}')`,
    `INSERT INTO booking_parties (id, booking_session_id, shop_id, lifecycle, currency, locale, version, created_at, updated_at) VALUES ('bpt_redeem_two', 'bsn_redeem_two', 'shp_redeem', 'active', 'USD', 'en', 1, '${now}', '${now}')`,
    `INSERT INTO gift_card_products (id, merchant_id, name, currency, scope, scope_id, preset_amounts_json, allows_custom_amount, active, created_at, updated_at) VALUES ('gcp_redeem', 'mrc_redeem', 'Redeem card', 'USD', 'shop', 'shp_redeem', '[10000]', 0, 1, '${now}', '${now}')`,
    `INSERT INTO gift_card_sales (id, shop_id, gift_card_product_id, status, amount_minor, currency, recipient_json, purchaser_json, created_at, updated_at) VALUES ('gcs_redeem', 'shp_redeem', 'gcp_redeem', 'issued', 10000, 'USD', 'null', '{}', '${now}', '${now}')`,
    `INSERT INTO gift_cards (id, gift_card_sale_id, code_hash, status, currency, scope, scope_id, initial_value_minor, created_at, updated_at) VALUES ('gcd_redeem', 'gcs_redeem', '99c2b6327613d09c0684bc98f56c0e898b4ccde191f37381de28d71b810e0c07', 'active', 'USD', 'shop', 'shp_redeem', 10000, '${now}', '${now}')`,
    `INSERT INTO gift_card_ledger_entries (id, gift_card_id, kind, amount_minor, idempotency_key, occurred_at, created_at) VALUES ('gcl_redeem_issue', 'gcd_redeem', 'issuance', 10000, 'issuance:gcd_redeem', '${now}', '${now}')`
  ])
    await test.d1.prepare(statement).run()
}, 60_000)

afterAll(async () => test.dispose())

const run = <A>(effect: Effect.Effect<A, unknown, GiftCardRedemptions>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(LiveGiftCardRedemptions.pipe(Layer.provide(layerFromD1(test.d1))))
    )
  )

describe('live Gift Card redemption', () => {
  it('serializes concurrent reservations and releases expired value', async () => {
    const reserve = (bookingPartyId: string, idempotencyKey: string) =>
      run(
        Effect.flatMap(GiftCardRedemptions, (cards) =>
          cards.reserve({
            giftCardCode: 'redeem-code',
            bookingPartyId,
            amountMinor: 7_000,
            maximumAmountMinor: 10_000,
            expiresAt: '2026-07-13T10:15:00.000Z',
            idempotencyKey,
            now
          })
        )
      )
    const outcomes = await Promise.allSettled([
      reserve('bpt_redeem_one', 'reserve-live-one'),
      reserve('bpt_redeem_two', 'reserve-live-two')
    ])
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
    expect(
      (
        await run(
          Effect.flatMap(GiftCardRedemptions, (cards) => cards.balance('gcd_redeem'))
        )
      ).availableMinor
    ).toBe(3_000)
    const reservedParty =
      outcomes[0]?.status === 'fulfilled' ? 'bpt_redeem_one' : 'bpt_redeem_two'
    await Promise.all([
      run(
        Effect.flatMap(GiftCardRedemptions, (cards) =>
          cards.release({
            bookingPartyId: reservedParty,
            idempotencyKey: 'release-live-one',
            now
          })
        )
      ),
      run(
        Effect.flatMap(GiftCardRedemptions, (cards) =>
          cards.release({
            bookingPartyId: reservedParty,
            idempotencyKey: 'release-live-two',
            now
          })
        )
      )
    ])
    expect(
      (
        await run(
          Effect.flatMap(GiftCardRedemptions, (cards) => cards.balance('gcd_redeem'))
        )
      ).availableMinor
    ).toBe(10_000)
    await reserve(reservedParty, 'reserve-live-expiry')
    expect(
      await run(
        Effect.flatMap(GiftCardRedemptions, (cards) =>
          cards.releaseExpired({ now: '2026-07-13T10:15:00.000Z' })
        )
      )
    ).toBe(1)
    expect(
      (
        await run(
          Effect.flatMap(GiftCardRedemptions, (cards) => cards.balance('gcd_redeem'))
        )
      ).availableMinor
    ).toBe(10_000)
  })

  it('restores only original Gift Card tender and rejects a second reversal', async () => {
    const reservation = await run(
      Effect.flatMap(GiftCardRedemptions, (cards) =>
        cards.reserve({
          giftCardCode: 'redeem-code',
          bookingPartyId: 'bpt_redeem_one',
          amountMinor: 4_000,
          maximumAmountMinor: 9_000,
          expiresAt: '2026-07-13T11:00:00.000Z',
          idempotencyKey: 'reserve-live-confirm',
          now
        })
      )
    )
    for (const statement of [
      `INSERT INTO gift_card_ledger_entries (id, gift_card_id, kind, amount_minor, booking_party_id, idempotency_key, occurred_at, created_at) VALUES ('gcl_commit_release', 'gcd_redeem', 'release', 4000, 'bpt_redeem_one', 'commit-release:test', '${now}', '${now}')`,
      `INSERT INTO gift_card_ledger_entries (id, gift_card_id, kind, amount_minor, booking_party_id, idempotency_key, occurred_at, created_at) VALUES ('gcl_commit_redeem', 'gcd_redeem', 'redemption', -4000, 'bpt_redeem_one', 'redemption:test', '${now}', '${now}')`,
      `UPDATE gift_card_reservations SET status = 'committed' WHERE id = '${reservation.id}'`,
      `INSERT INTO settlement_allocations (id, booking_party_id, tender, reference_id, amount_minor, currency, created_at) VALUES ('sta_gift_test', 'bpt_redeem_one', 'gift_card', 'gcd_redeem', 4000, 'USD', '${now}')`,
      `INSERT INTO settlement_allocations (id, booking_party_id, tender, reference_id, amount_minor, currency, created_at) VALUES ('sta_external_test', 'bpt_redeem_one', 'external_payment', 'pay_redeem', 5000, 'USD', '${now}')`
    ])
      await test.d1.prepare(statement).run()
    const refund = (idempotencyKey: string) =>
      run(
        Effect.flatMap(GiftCardRedemptions, (cards) =>
          cards.refund({
            bookingPartyId: 'bpt_redeem_one',
            idempotencyKey,
            now: '2026-07-14T10:00:00.000Z'
          })
        )
      )
    const refundOutcomes = await Promise.allSettled([
      refund('refund-live-one'),
      refund('refund-live-two')
    ])
    expect(
      refundOutcomes.filter((outcome) => outcome.status === 'fulfilled')
    ).toHaveLength(1)
    expect(
      refundOutcomes.filter((outcome) => outcome.status === 'rejected')
    ).toHaveLength(1)
    const winningKey =
      refundOutcomes[0]?.status === 'fulfilled' ? 'refund-live-one' : 'refund-live-two'
    expect(await refund(winningKey)).toMatchObject({
      restoredGiftCardMinor: 4_000,
      externalPaymentMinor: 5_000
    })
    expect(
      (
        await run(
          Effect.flatMap(GiftCardRedemptions, (cards) => cards.balance('gcd_redeem'))
        )
      ).availableMinor
    ).toBe(10_000)
    const stored = await test.d1
      .prepare('SELECT status FROM gift_card_reservations WHERE id = ?')
      .bind(reservation.id)
      .first<{ status: string }>()
    expect(stored?.status).toBe('committed')
  })

  it('does not void value already spent unless an explicit adjustment rule accepts the liability', async () => {
    for (const statement of [
      `INSERT INTO payments (id, amount_minor, status, currency, captured_minor, refunded_minor, created_at, updated_at) VALUES ('pay_sale_refund', 10000, 'refunded', 'USD', 10000, 10000, '${now}', '${now}')`,
      `UPDATE gift_card_sales SET payment_id = 'pay_sale_refund' WHERE id = 'gcs_redeem'`,
      `INSERT INTO gift_card_ledger_entries (id, gift_card_id, kind, amount_minor, idempotency_key, occurred_at, created_at) VALUES ('gcl_later_spend', 'gcd_redeem', 'redemption', -1000, 'later-spend', '${now}', '${now}')`
    ])
      await test.d1.prepare(statement).run()
    const resume = (spentValueAdjustment?: 'merchant_liability') =>
      Effect.runPromise(
        Effect.flatMap(GiftCardSales, (cards) =>
          cards.resumeIssuanceForPayment({
            paymentId: 'pay_sale_refund',
            now,
            ...(spentValueAdjustment ? { spentValueAdjustment } : {})
          })
        ).pipe(
          Effect.provide(LiveGiftCardSales.pipe(Layer.provide(layerFromD1(test.d1))))
        )
      )
    await expect(resume()).rejects.toMatchObject({
      code: 'spent_value_requires_adjustment'
    })
    await expect(resume('merchant_liability')).resolves.toMatchObject({
      sale: { status: 'refunded' },
      card: { status: 'voided', balanceMinor: 0 }
    })
  })
})
