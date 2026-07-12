import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { layerFromD1 } from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { LiveGiftCardSales } from './adapters.ts'
import { GiftCardSales } from './gift-card-sales.ts'

let test: TestD1
const now = '2026-07-12T12:00:00.000Z'

beforeAll(async () => {
  test = await provisionTestD1()
  for (const statement of [
    `INSERT INTO merchants (id, public_name, slug, timezone, currency, plan, created_at, updated_at) VALUES ('mrc_gift', 'Gift Shop', 'gift-shop', 'UTC', 'USD', 'solo', '${now}', '${now}')`,
    `INSERT INTO brands (id, merchant_id, name, created_at, updated_at) VALUES ('brd_gift', 'mrc_gift', 'Gift Shop', '${now}', '${now}')`,
    `INSERT INTO shops (id, brand_id, merchant_id, slug, public_name, timezone, currency, created_at, updated_at) VALUES ('shp_gift', 'brd_gift', 'mrc_gift', 'downtown', 'Gift Shop', 'UTC', 'USD', '${now}', '${now}')`,
    `INSERT INTO providers (id, merchant_id, display_name, status, booking_access, is_default, created_at, updated_at) VALUES ('prv_gift', 'mrc_gift', 'Jordan', 'active', 'public', 1, '${now}', '${now}')`,
    `INSERT INTO providers (id, merchant_id, display_name, status, booking_access, is_default, created_at, updated_at) VALUES ('prv_other_shop', 'mrc_gift', 'Other', 'active', 'public', 0, '${now}', '${now}')`,
    `INSERT INTO shop_providers (shop_id, provider_id, created_at) VALUES ('shp_gift', 'prv_gift', '${now}')`,
    `INSERT INTO gift_card_products (id, merchant_id, name, currency, scope, scope_id, preset_amounts_json, allows_custom_amount, active, created_at, updated_at) VALUES ('gcp_gift', 'mrc_gift', 'A fresh cut', 'USD', 'shop', 'shp_gift', '[5000]', 0, 1, '${now}', '${now}')`,
    `INSERT INTO payments (id, booking_party_id, pricing_quote_id, amount_minor, status, currency, authorized_minor, captured_minor, refunded_minor, created_at, updated_at) VALUES ('pay_gift_live', NULL, NULL, 5000, 'captured', 'USD', 0, 5000, 0, '${now}', '${now}')`
  ])
    await test.d1.prepare(statement).run()
}, 60_000)

afterAll(async () => test.dispose())
const layer = () => LiveGiftCardSales.pipe(Layer.provide(layerFromD1(test.d1)))
const run = <A>(effect: Effect.Effect<A, unknown, GiftCardSales>) =>
  Effect.runPromise(effect.pipe(Effect.provide(layer())))

describe('live Gift Card issuance', () => {
  it('recovers local failure and concurrent retries without duplicating value', async () => {
    await expect(
      run(
        Effect.flatMap(GiftCardSales, (cards) =>
          cards.resolvePurchaseRoute({
            merchantSlug: 'gift-shop',
            shopSlug: 'downtown',
            providerLocator: 'prv_gift'
          })
        )
      )
    ).resolves.toMatchObject({ providerId: 'prv_gift' })
    await expect(
      run(
        Effect.flatMap(GiftCardSales, (cards) =>
          cards.resolvePurchaseRoute({
            merchantSlug: 'gift-shop',
            shopSlug: 'downtown',
            providerLocator: 'prv_other_shop'
          })
        )
      )
    ).rejects.toMatchObject({ code: 'purchase_route_not_found' })
    const sale = await run(
      Effect.flatMap(GiftCardSales, (cards) =>
        cards.createSale({
          brandId: 'brd_gift',
          shopId: 'shp_gift',
          giftCardProductId: 'gcp_gift',
          amountMinor: 5000,
          currency: 'USD',
          purchaser: { name: 'Alex', email: 'alex@example.com' },
          recipient: { name: 'Sam', email: 'sam@example.com' },
          idempotencyKey: 'gift-live',
          now
        })
      )
    )
    await test.d1
      .prepare(
        `UPDATE gift_card_sales SET payment_id = 'pay_gift_live', status = 'issuing' WHERE id = ?`
      )
      .bind(sale.id)
      .run()
    await run(
      Effect.flatMap(GiftCardSales, (cards) =>
        cards.protectReceipt({
          saleId: sale.id,
          routeId: 'gcr_live',
          tokenHash: 'stable-token',
          signingKeyId: 'test-key',
          expiresAt: '2026-08-12T12:00:00.000Z',
          now
        })
      )
    )
    await test.d1
      .prepare(
        "CREATE TRIGGER reject_gift_ledger BEFORE INSERT ON gift_card_ledger_entries BEGIN SELECT RAISE(ABORT, 'forced local failure'); END"
      )
      .run()
    const issue = () =>
      run(
        Effect.flatMap(GiftCardSales, (cards) =>
          cards.resumeIssuanceForPayment({ paymentId: 'pay_gift_live', now })
        )
      )
    await expect(issue()).rejects.toMatchObject({
      _tag: 'CapabilityUnavailable'
    })
    await test.d1.prepare('DROP TRIGGER reject_gift_ledger').run()
    await Promise.all([issue(), issue()])
    const ledger = await test.d1
      .prepare(
        `SELECT count(*) count, sum(amount_minor) balance FROM gift_card_ledger_entries WHERE kind = 'issuance'`
      )
      .first<{ count: number; balance: number }>()
    expect(ledger).toEqual({ count: 1, balance: 5000 })
    const cards = await test.d1
      .prepare('SELECT count(*) count FROM gift_cards')
      .first<{ count: number }>()
    expect(cards?.count).toBe(1)
  })
})
