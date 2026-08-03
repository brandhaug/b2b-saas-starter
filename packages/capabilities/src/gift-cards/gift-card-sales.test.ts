import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  GiftCardSales,
  SeedGiftCardPayment,
  SeedGiftCardSales,
  emptySeedGiftCardSalesStore,
  hashGiftCardReceiptToken,
  purchaseAndIssueGiftCard
} from './gift-card-sales.ts'
import { PaymentProvider } from '../payments/payment-settlement.ts'

const product = {
  id: 'gcp_shop',
  merchantId: 'mer_demo',
  name: 'A fresh cut',
  currency: 'USD',
  scope: 'shop' as const,
  scopeId: 'shp_demo',
  presetAmountsMinor: [2_500, 5_000],
  allowsCustomAmount: true,
  active: true
}

const people = {
  purchaser: { name: 'Alex Buyer', email: 'alex@example.com' },
  recipient: { name: 'Sam Friend', email: 'sam@example.com', message: 'Enjoy!' }
}

describe('Gift Card purchase and issuance', () => {
  it('issues exactly one Gift Card after captured payment and replays the receipt', async () => {
    const store = emptySeedGiftCardSalesStore({
      products: [product],
      capturedPayments: [{ id: 'pay_gift', amountMinor: 5_000, currency: 'USD' }]
    })
    const run = <A>(effect: Effect.Effect<A, unknown, GiftCardSales>) =>
      Effect.runPromise(effect.pipe(Effect.provide(SeedGiftCardSales(store))))
    const sale = await run(
      Effect.flatMap(GiftCardSales, (cards) =>
        cards.createSale({
          brandId: 'brd_demo',
          shopId: 'shp_demo',
          giftCardProductId: product.id,
          amountMinor: 5_000,
          currency: 'USD',
          idempotencyKey: 'purchase-1',
          ...people,
          now: '2026-07-12T12:00:00.000Z'
        })
      )
    )
    const issue = () =>
      run(
        Effect.flatMap(GiftCardSales, (cards) =>
          cards.issue({
            saleId: sale.id,
            paymentId: 'pay_gift',
            idempotencyKey: 'payment-captured:pay_gift',
            now: '2026-07-12T12:01:00.000Z',
            access: {
              routeId: 'gcr_sale',
              tokenHash: 'token-hash',
              expiresAt: '2026-08-12T12:01:00.000Z'
            }
          })
        )
      )

    const first = await issue()
    expect(await issue()).toEqual(first)
    expect(first).toMatchObject({
      sale: { id: sale.id, status: 'issued', amountMinor: 5_000 },
      card: {
        status: 'active',
        initialValueMinor: 5_000,
        balanceMinor: 5_000,
        scope: 'shop',
        scopeId: 'shp_demo'
      }
    })
    expect(store.cards.size).toBe(1)
    expect(store.ledger).toHaveLength(1)
  })

  it('rejects an unpermitted amount and cannot issue before matching capture', async () => {
    const fixed = { ...product, allowsCustomAmount: false }
    const store = emptySeedGiftCardSalesStore({ products: [fixed] })
    const run = <A>(effect: Effect.Effect<A, unknown, GiftCardSales>) =>
      Effect.runPromise(effect.pipe(Effect.provide(SeedGiftCardSales(store))))
    const create = (amountMinor: number) =>
      run(
        Effect.flatMap(GiftCardSales, (cards) =>
          cards.createSale({
            brandId: 'brd_demo',
            shopId: 'shp_demo',
            giftCardProductId: fixed.id,
            amountMinor,
            currency: 'USD',
            idempotencyKey: `purchase-${amountMinor}`,
            ...people,
            now: '2026-07-12T12:00:00.000Z'
          })
        )
      )
    await expect(create(3_000)).rejects.toMatchObject({ code: 'amount_not_permitted' })
    const sale = await create(2_500)
    await expect(
      run(
        Effect.flatMap(GiftCardSales, (cards) =>
          cards.issue({
            saleId: sale.id,
            paymentId: 'pay_missing',
            idempotencyKey: 'capture-missing',
            now: '2026-07-12T12:01:00.000Z',
            access: {
              routeId: 'gcr_missing',
              tokenHash: 'token-hash',
              expiresAt: '2026-08-12T12:01:00.000Z'
            }
          })
        )
      )
    ).rejects.toMatchObject({ code: 'captured_payment_required' })
    expect(store.cards.size).toBe(0)
  })

  it('lists only active products applicable to the selected shop or provider', async () => {
    const store = emptySeedGiftCardSalesStore({
      products: [
        product,
        { ...product, id: 'gcp_provider', scope: 'provider', scopeId: 'pro_lee' },
        { ...product, id: 'gcp_other', scopeId: 'shp_other' }
      ]
    })
    const products = await Effect.runPromise(
      Effect.flatMap(GiftCardSales, (cards) =>
        cards.listProducts({
          merchantId: 'mer_demo',
          brandId: 'brd_demo',
          shopId: 'shp_demo',
          providerId: 'pro_lee'
        })
      ).pipe(Effect.provide(SeedGiftCardSales(store)))
    )
    expect(products.map(({ id }) => id)).toEqual(['gcp_provider', 'gcp_shop'])
  })

  it('offers Merchant-wide value and permits an unassigned purchase', async () => {
    const merchantProduct = {
      ...product,
      id: 'gcp_merchant',
      scope: 'merchant' as const,
      scopeId: 'mer_demo'
    }
    const store = emptySeedGiftCardSalesStore({ products: [merchantProduct] })
    const layer = SeedGiftCardSales(store)
    const products = await Effect.runPromise(
      Effect.flatMap(GiftCardSales, (cards) =>
        cards.listProducts({
          merchantId: 'mer_demo',
          brandId: 'brd_demo',
          shopId: 'shp_demo'
        })
      ).pipe(Effect.provide(layer))
    )
    expect(products.map(({ id }) => id)).toEqual(['gcp_merchant'])
    const sale = await Effect.runPromise(
      Effect.flatMap(GiftCardSales, (cards) =>
        cards.createSale({
          brandId: 'brd_demo',
          shopId: 'shp_demo',
          giftCardProductId: merchantProduct.id,
          amountMinor: 2_500,
          currency: 'USD',
          idempotencyKey: 'unassigned',
          purchaser: people.purchaser,
          recipient: null,
          now: '2026-07-12T12:00:00.000Z'
        })
      ).pipe(Effect.provide(layer))
    )
    expect(sale.recipient).toBeNull()
  })

  it('settles online payment, issues once, and protects the receipt token', async () => {
    const store = emptySeedGiftCardSalesStore({ products: [product] })
    const provider = Layer.succeed(PaymentProvider)({
      configuration: { provider: 'test', state: 'configured', methods: ['card'] },
      settle: ({ payment }) =>
        Effect.succeed({
          outcome: 'succeeded',
          providerReference: 'pi_gift',
          facts: [
            {
              kind: 'capture',
              amountMinor: payment.amountMinor,
              currency: payment.currency,
              providerReference: 'ch_gift',
              occurredAt: '2026-07-12T12:00:01.000Z'
            }
          ]
        })
    })
    const layer = Layer.merge(
      SeedGiftCardSales(store),
      SeedGiftCardPayment(store)
    ).pipe(Layer.provideMerge(provider))
    const result = await Effect.runPromise(
      purchaseAndIssueGiftCard({
        brandId: 'brd_demo',
        shopId: 'shp_demo',
        giftCardProductId: product.id,
        amountMinor: 2_500,
        currency: 'USD',
        idempotencyKey: 'purchase-online',
        ...people,
        now: '2026-07-12T12:00:00.000Z',
        method: 'card',
        paymentMethodReference: 'pm_test',
        returnUrl: 'https://booking.test/return',
        receiptKeyring: {
          currentKeyId: 'test',
          keys: { test: 'test-receipt-secret' }
        }
      }).pipe(Effect.provide(layer))
    )
    expect(result.state).toBe('issued')
    if (result.state !== 'issued') throw new Error('expected issued')
    const tokenHash = await Effect.runPromise(
      hashGiftCardReceiptToken(result.access.token)
    )
    const read = (hash: string) =>
      Effect.runPromise(
        Effect.flatMap(GiftCardSales, (cards) =>
          cards.receipt({
            routeId: result.access.routeId,
            tokenHash: hash,
            now: '2026-07-13T12:00:00.000Z'
          })
        ).pipe(Effect.provide(layer))
      )
    await expect(read('wrong')).rejects.toMatchObject({ code: 'receipt_not_found' })
    await expect(read(tokenHash)).resolves.toEqual(result.receipt)
    expect(store.cards.size).toBe(1)
    expect(store.ledger).toHaveLength(1)
  })

  it('resumes issuance after an asynchronous provider capture and replays stable access', async () => {
    const store = emptySeedGiftCardSalesStore({ products: [product] })
    const provider = Layer.succeed(PaymentProvider)({
      configuration: { provider: 'test', state: 'configured', methods: ['card'] },
      settle: () =>
        Effect.succeed({
          outcome: 'processing',
          providerReference: 'pi_async',
          facts: [],
          nextActionUrl: 'https://provider.test/next'
        })
    })
    const layer = Layer.merge(
      SeedGiftCardSales(store),
      SeedGiftCardPayment(store)
    ).pipe(Layer.provideMerge(provider))
    const command = {
      brandId: 'brd_demo',
      shopId: 'shp_demo',
      giftCardProductId: product.id,
      amountMinor: 2_500,
      currency: 'USD',
      idempotencyKey: 'purchase-async',
      ...people,
      now: '2026-07-12T12:00:00.000Z',
      method: 'card' as const,
      paymentMethodReference: 'pm_async',
      returnUrl: 'https://booking.test/mara/booking/gift-card-sales',
      receiptKeyring: { currentKeyId: 'current', keys: { current: 'stable-secret' } }
    }
    const processing = await Effect.runPromise(
      purchaseAndIssueGiftCard(command).pipe(Effect.provide(layer))
    )
    expect(processing.state).toBe('processing')
    if (processing.state !== 'processing') throw new Error('expected processing')
    const sale = store.sales.get(processing.sale.id)!
    store.capturedPayments.set(sale.paymentId!, {
      id: sale.paymentId!,
      amountMinor: sale.amountMinor,
      currency: sale.currency
    })
    store.sales.set(sale.id, { ...sale, status: 'issuing' })
    const issued = await Effect.runPromise(
      Effect.flatMap(GiftCardSales, (cards) =>
        cards.resumeIssuanceForPayment({
          paymentId: sale.paymentId!,
          now: '2026-07-12T12:01:00.000Z'
        })
      ).pipe(Effect.provide(layer))
    )
    expect(issued?.sale.status).toBe('issued')
    expect(store.ledger).toHaveLength(1)
    const replay = await Effect.runPromise(
      purchaseAndIssueGiftCard({
        ...command,
        receiptKeyring: {
          currentKeyId: 'next',
          keys: { current: 'stable-secret', next: 'rotated-secret' }
        }
      }).pipe(Effect.provide(layer))
    )
    expect(replay.state).toBe('issued')
    if (replay.state === 'issued')
      expect(replay.access.token).toBe(processing.access.token)
  })

  it('rejects reuse of an idempotency key with changed purchase facts', async () => {
    const store = emptySeedGiftCardSalesStore({ products: [product] })
    const run = (amountMinor: number) =>
      Effect.runPromise(
        Effect.flatMap(GiftCardSales, (cards) =>
          cards.createSale({
            brandId: 'brd_demo',
            shopId: 'shp_demo',
            giftCardProductId: product.id,
            amountMinor,
            currency: 'USD',
            idempotencyKey: 'same-command',
            ...people,
            now: '2026-07-12T12:00:00.000Z'
          })
        ).pipe(Effect.provide(SeedGiftCardSales(store)))
      )
    await run(2_500)
    await expect(run(5_000)).rejects.toMatchObject({ code: 'idempotency_mismatch' })
  })

  it('exchanges receipt URL access exactly once for a cookie credential', async () => {
    const store = emptySeedGiftCardSalesStore({
      products: [product],
      capturedPayments: [{ id: 'pay_gift', amountMinor: 5_000, currency: 'USD' }]
    })
    const layer = SeedGiftCardSales(store)
    const run = <A>(effect: Effect.Effect<A, unknown, GiftCardSales>) =>
      Effect.runPromise(effect.pipe(Effect.provide(layer)))
    const sale = await run(
      Effect.flatMap(GiftCardSales, (cards) =>
        cards.createSale({
          brandId: 'brd_demo',
          shopId: 'shp_demo',
          giftCardProductId: product.id,
          amountMinor: 5_000,
          currency: 'USD',
          idempotencyKey: 'exchange-once',
          ...people,
          now: '2026-07-12T12:00:00.000Z'
        })
      )
    )
    await run(
      Effect.flatMap(GiftCardSales, (cards) =>
        cards.protectReceipt({
          saleId: sale.id,
          routeId: 'gcr_exchange',
          tokenHash: 'url-hash',
          signingKeyId: 'current',
          expiresAt: '2026-08-12T12:00:00.000Z',
          now: '2026-07-12T12:00:00.000Z'
        })
      )
    )
    const exchange = () =>
      run(
        Effect.flatMap(GiftCardSales, (cards) =>
          cards.exchangeReceiptAccess({
            routeId: 'gcr_exchange',
            presentedTokenHash: 'url-hash',
            cookieTokenHash: 'cookie-hash',
            now: '2026-07-12T12:01:00.000Z'
          })
        )
      )
    await exchange()
    await expect(exchange()).rejects.toMatchObject({ code: 'receipt_not_found' })
    expect(store.receiptAccess.get('gcr_exchange')?.tokenHash).toBe('cookie-hash')
  })

  it('rejects a Brand product from another Brand under the same Merchant', async () => {
    const crossBrand = {
      ...product,
      id: 'gcp_other_brand',
      scope: 'brand' as const,
      scopeId: 'brd_other'
    }
    const store = emptySeedGiftCardSalesStore({ products: [crossBrand] })
    await expect(
      Effect.runPromise(
        Effect.flatMap(GiftCardSales, (cards) =>
          cards.createSale({
            brandId: 'brd_demo',
            shopId: 'shp_demo',
            giftCardProductId: crossBrand.id,
            amountMinor: 2_500,
            currency: 'USD',
            idempotencyKey: 'cross-brand',
            ...people,
            now: '2026-07-12T12:00:00.000Z'
          })
        ).pipe(Effect.provide(SeedGiftCardSales(store)))
      )
    ).rejects.toMatchObject({ code: 'product_scope_mismatch' })
  })
})
