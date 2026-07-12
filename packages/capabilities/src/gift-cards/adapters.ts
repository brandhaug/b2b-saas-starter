import { Effect, Layer } from 'effect'
import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  batch,
  Database,
  giftCardLedgerEntries,
  giftCardProducts,
  giftCardSales,
  giftCards,
  merchants,
  paymentAttempts,
  paymentTransactions,
  payments,
  providers,
  shops,
  shopProviders
} from '@b2b-saas-starter/db'
import { orUnavailable } from '../internal/unavailable.ts'
import { GiftCardNotFound, GiftCards } from './index.ts'
import {
  GiftCardPayment,
  GiftCardSaleConflict,
  GiftCardSales,
  giftCardAmountIsPermitted,
  sortGiftCardProducts,
  type GiftCardSalesShape
} from './gift-card-sales.ts'
import { PaymentProvider } from '../payments/payment-settlement.ts'

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

const stableSuffix = (value: string) => {
  let hash = 2166136261
  for (const character of value)
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  return (hash >>> 0).toString(36)
}

export const LiveGiftCardSales: Layer.Layer<GiftCardSales, never, Database> =
  Layer.effect(
    GiftCardSales,
    Effect.gen(function* () {
      const db = yield* Database
      const readReceiptBySale = (saleId: string) =>
        Effect.gen(function* () {
          const [sale] = yield* orUnavailable('gift-card-sales')(
            db.select().from(giftCardSales).where(eq(giftCardSales.id, saleId)).limit(1)
          )
          if (!sale || sale.status !== 'issued' || !sale.giftCardProductId)
            return yield* new GiftCardSaleConflict({ code: 'receipt_not_found' })
          const [card] = yield* orUnavailable('gift-card-sales')(
            db
              .select()
              .from(giftCards)
              .where(eq(giftCards.giftCardSaleId, saleId))
              .limit(1)
          )
          if (!card)
            return yield* new GiftCardSaleConflict({ code: 'receipt_not_found' })
          const [{ balanceMinor } = { balanceMinor: 0 }] = yield* orUnavailable(
            'gift-card-sales'
          )(
            db
              .select({
                balanceMinor: sql<number>`coalesce(sum(${giftCardLedgerEntries.amountMinor}), 0)`
              })
              .from(giftCardLedgerEntries)
              .where(eq(giftCardLedgerEntries.giftCardId, card.id))
          )
          return {
            sale: {
              id: sale.id,
              status: sale.status,
              shopId: sale.shopId,
              giftCardProductId: sale.giftCardProductId,
              amountMinor: sale.amountMinor,
              currency: sale.currency,
              purchaser: JSON.parse(sale.purchaserJson),
              recipient: JSON.parse(sale.recipientJson),
              paymentId: sale.paymentId
            },
            card: {
              id: card.id,
              status: card.status,
              currency: card.currency,
              scope: card.scope,
              scopeId: card.scopeId,
              initialValueMinor: card.initialValueMinor,
              balanceMinor
            }
          }
        })
      const service: GiftCardSalesShape = {
        resolvePurchaseRoute: (input) =>
          Effect.gen(function* () {
            const [selection] = yield* orUnavailable('gift-card-sales')(
              db
                .select({
                  merchantId: merchants.id,
                  brandId: shops.brandId,
                  shopId: shops.id
                })
                .from(shops)
                .innerJoin(merchants, eq(merchants.id, shops.merchantId))
                .where(
                  and(
                    eq(merchants.slug, input.merchantSlug),
                    eq(shops.slug, input.shopSlug)
                  )
                )
                .limit(1)
            )
            if (!selection)
              return yield* new GiftCardSaleConflict({
                code: 'purchase_route_not_found'
              })
            if (input.providerLocator === 'any') return selection
            const [provider] = yield* orUnavailable('gift-card-sales')(
              db
                .select({ id: providers.id })
                .from(providers)
                .innerJoin(shopProviders, eq(shopProviders.providerId, providers.id))
                .where(
                  and(
                    eq(providers.id, input.providerLocator),
                    eq(providers.merchantId, selection.merchantId),
                    eq(shopProviders.shopId, selection.shopId),
                    eq(providers.status, 'active')
                  )
                )
                .limit(1)
            )
            if (!provider)
              return yield* new GiftCardSaleConflict({
                code: 'purchase_route_not_found'
              })
            return { ...selection, providerId: provider.id }
          }),
        listProducts: ({ merchantId, brandId, shopId, providerId }) =>
          Effect.map(
            orUnavailable('gift-card-sales')(
              db
                .select()
                .from(giftCardProducts)
                .where(
                  and(
                    eq(giftCardProducts.merchantId, merchantId),
                    eq(giftCardProducts.active, true),
                    inArray(giftCardProducts.scopeId, [
                      merchantId,
                      brandId,
                      shopId,
                      ...(providerId ? [providerId] : [])
                    ])
                  )
                )
            ),
            (rows) =>
              sortGiftCardProducts(
                rows.map((row) => ({
                  ...row,
                  presetAmountsMinor: JSON.parse(row.presetAmountsJson) as number[]
                }))
              )
          ),
        createSale: (input) =>
          Effect.gen(function* () {
            const id = `gcs_${stableSuffix(input.idempotencyKey)}`
            const [replay] = yield* orUnavailable('gift-card-sales')(
              db.select().from(giftCardSales).where(eq(giftCardSales.id, id)).limit(1)
            )
            if (replay && replay.giftCardProductId) {
              const result = {
                id: replay.id,
                status: replay.status,
                shopId: replay.shopId,
                giftCardProductId: replay.giftCardProductId,
                amountMinor: replay.amountMinor,
                currency: replay.currency,
                purchaser: JSON.parse(replay.purchaserJson),
                recipient: JSON.parse(replay.recipientJson),
                paymentId: replay.paymentId
              }
              if (
                result.shopId !== input.shopId ||
                result.giftCardProductId !== input.giftCardProductId ||
                result.amountMinor !== input.amountMinor ||
                result.currency !== input.currency ||
                JSON.stringify(result.purchaser) !== JSON.stringify(input.purchaser) ||
                JSON.stringify(result.recipient) !== JSON.stringify(input.recipient)
              )
                return yield* new GiftCardSaleConflict({
                  code: 'idempotency_mismatch'
                })
              return result
            }
            const [product] = yield* orUnavailable('gift-card-sales')(
              db
                .select()
                .from(giftCardProducts)
                .where(
                  and(
                    eq(giftCardProducts.id, input.giftCardProductId),
                    eq(giftCardProducts.active, true)
                  )
                )
                .limit(1)
            )
            const [shop] = yield* orUnavailable('gift-card-sales')(
              db.select().from(shops).where(eq(shops.id, input.shopId)).limit(1)
            )
            if (!product || !shop || shop.merchantId !== product.merchantId)
              return yield* new GiftCardSaleConflict({ code: 'product_unavailable' })
            if (
              (product.scope === 'merchant' &&
                product.scopeId !== product.merchantId) ||
              (product.scope === 'brand' && product.scopeId !== input.brandId) ||
              (product.scope === 'shop' && product.scopeId !== input.shopId) ||
              (product.scope === 'provider' && product.scopeId !== input.providerId)
            )
              return yield* new GiftCardSaleConflict({
                code: 'product_scope_mismatch'
              })
            if (input.currency !== product.currency)
              return yield* new GiftCardSaleConflict({ code: 'currency_mismatch' })
            const presets = JSON.parse(product.presetAmountsJson) as number[]
            if (
              !giftCardAmountIsPermitted(
                { ...product, presetAmountsMinor: presets },
                input.amountMinor
              )
            )
              return yield* new GiftCardSaleConflict({ code: 'amount_not_permitted' })
            yield* orUnavailable('gift-card-sales')(
              db
                .insert(giftCardSales)
                .values({
                  id,
                  shopId: input.shopId,
                  giftCardProductId: product.id,
                  amountMinor: input.amountMinor,
                  currency: input.currency,
                  recipientJson: JSON.stringify(input.recipient),
                  purchaserJson: JSON.stringify(input.purchaser),
                  createdAt: input.now,
                  updatedAt: input.now
                })
                .onConflictDoNothing()
            )
            return {
              id,
              status: 'pending_payment' as const,
              shopId: input.shopId,
              giftCardProductId: product.id,
              amountMinor: input.amountMinor,
              currency: input.currency,
              purchaser: input.purchaser,
              recipient: input.recipient,
              paymentId: null
            }
          }),
        protectReceipt: (input) =>
          Effect.gen(function* () {
            const [sale] = yield* orUnavailable('gift-card-sales')(
              db
                .select({
                  id: giftCardSales.id,
                  routeId: giftCardSales.receiptRouteId,
                  signingKeyId: giftCardSales.receiptSigningKeyId,
                  expiresAt: giftCardSales.receiptExpiresAt
                })
                .from(giftCardSales)
                .where(eq(giftCardSales.id, input.saleId))
                .limit(1)
            )
            if (!sale)
              return yield* new GiftCardSaleConflict({ code: 'sale_not_found' })
            if (sale.routeId && sale.signingKeyId && sale.expiresAt)
              return {
                routeId: sale.routeId,
                signingKeyId: sale.signingKeyId,
                expiresAt: sale.expiresAt
              }
            yield* orUnavailable('gift-card-sales')(
              db
                .update(giftCardSales)
                .set({
                  receiptRouteId: input.routeId,
                  receiptTokenHash: input.tokenHash,
                  receiptSigningKeyId: input.signingKeyId,
                  receiptExpiresAt: input.expiresAt,
                  updatedAt: input.now
                })
                .where(eq(giftCardSales.id, input.saleId))
            )
            return {
              routeId: input.routeId,
              signingKeyId: input.signingKeyId,
              expiresAt: input.expiresAt
            }
          }),
        issue: (input) =>
          Effect.gen(function* () {
            const existing = yield* Effect.option(readReceiptBySale(input.saleId))
            if (existing._tag === 'Some') return existing.value
            const [sale] = yield* orUnavailable('gift-card-sales')(
              db
                .select()
                .from(giftCardSales)
                .where(eq(giftCardSales.id, input.saleId))
                .limit(1)
            )
            const [payment] = yield* orUnavailable('gift-card-sales')(
              db
                .select()
                .from(payments)
                .where(eq(payments.id, input.paymentId))
                .limit(1)
            )
            const [paymentClaim] = payment
              ? yield* orUnavailable('gift-card-sales')(
                  db
                    .select({ id: giftCardSales.id })
                    .from(giftCardSales)
                    .where(eq(giftCardSales.paymentId, payment.id))
                    .limit(1)
                )
              : []
            if (
              !sale ||
              !payment ||
              payment.bookingPartyId !== null ||
              (paymentClaim && paymentClaim.id !== sale.id) ||
              payment.status !== 'captured' ||
              payment.capturedMinor !== sale.amountMinor ||
              payment.currency !== sale.currency
            )
              return yield* new GiftCardSaleConflict({
                code: 'captured_payment_required'
              })
            const [product] = yield* orUnavailable('gift-card-sales')(
              db
                .select()
                .from(giftCardProducts)
                .where(eq(giftCardProducts.id, sale.giftCardProductId!))
                .limit(1)
            )
            if (!product)
              return yield* new GiftCardSaleConflict({ code: 'product_unavailable' })
            const cardId = `gcd_${stableSuffix(sale.id)}`
            const issuanceKey = `gift-card-issuance:${sale.id}`
            yield* orUnavailable('gift-card-sales')(
              batch(db, [
                db
                  .insert(giftCards)
                  .values({
                    id: cardId,
                    giftCardSaleId: sale.id,
                    codeHash: `gch_${stableSuffix(`${sale.id}:code`)}`,
                    currency: sale.currency,
                    scope: product.scope,
                    scopeId: product.scopeId,
                    initialValueMinor: sale.amountMinor,
                    createdAt: input.now,
                    updatedAt: input.now
                  })
                  .onConflictDoNothing(),
                db
                  .insert(giftCardLedgerEntries)
                  .values({
                    id: `gcl_${stableSuffix(issuanceKey)}`,
                    giftCardId: cardId,
                    kind: 'issuance',
                    amountMinor: sale.amountMinor,
                    idempotencyKey: issuanceKey,
                    occurredAt: input.now,
                    createdAt: input.now
                  })
                  .onConflictDoNothing(),
                db
                  .update(giftCardSales)
                  .set({
                    status: 'issued',
                    paymentId: payment.id,
                    receiptRouteId: input.access.routeId,
                    receiptTokenHash: input.access.tokenHash,
                    receiptExpiresAt: input.access.expiresAt,
                    updatedAt: input.now
                  })
                  .where(eq(giftCardSales.id, sale.id))
              ])
            )
            return yield* readReceiptBySale(sale.id)
          }),
        receipt: (input) =>
          Effect.gen(function* () {
            const [sale] = yield* orUnavailable('gift-card-sales')(
              db
                .select({
                  id: giftCardSales.id,
                  tokenHash: giftCardSales.receiptTokenHash,
                  expiresAt: giftCardSales.receiptExpiresAt
                })
                .from(giftCardSales)
                .where(eq(giftCardSales.receiptRouteId, input.routeId))
                .limit(1)
            )
            if (
              !sale ||
              sale.tokenHash !== input.tokenHash ||
              !sale.expiresAt ||
              sale.expiresAt <= input.now
            )
              return yield* new GiftCardSaleConflict({ code: 'receipt_not_found' })
            return yield* readReceiptBySale(sale.id)
          }),
        receiptState: (input) =>
          Effect.gen(function* () {
            const [sale] = yield* orUnavailable('gift-card-sales')(
              db
                .select({
                  id: giftCardSales.id,
                  status: giftCardSales.status,
                  tokenHash: giftCardSales.receiptTokenHash,
                  expiresAt: giftCardSales.receiptExpiresAt
                })
                .from(giftCardSales)
                .where(eq(giftCardSales.receiptRouteId, input.routeId))
                .limit(1)
            )
            if (
              !sale ||
              sale.tokenHash !== input.tokenHash ||
              !sale.expiresAt ||
              sale.expiresAt <= input.now
            )
              return yield* new GiftCardSaleConflict({ code: 'receipt_not_found' })
            if (sale.status !== 'issued') return { state: 'processing' as const }
            return {
              state: 'issued' as const,
              receipt: yield* readReceiptBySale(sale.id)
            }
          }),
        resumeIssuanceForPayment: (input) =>
          Effect.gen(function* () {
            const [sale] = yield* orUnavailable('gift-card-sales')(
              db
                .select()
                .from(giftCardSales)
                .where(eq(giftCardSales.paymentId, input.paymentId))
                .limit(1)
            )
            if (!sale) return null
            if (
              !sale.receiptRouteId ||
              !sale.receiptTokenHash ||
              !sale.receiptExpiresAt
            )
              return yield* new GiftCardSaleConflict({ code: 'receipt_not_found' })
            return yield* service.issue({
              saleId: sale.id,
              paymentId: input.paymentId,
              idempotencyKey: `gift-card-issuance:${sale.id}`,
              now: input.now,
              access: {
                routeId: sale.receiptRouteId,
                tokenHash: sale.receiptTokenHash,
                expiresAt: sale.receiptExpiresAt
              }
            })
          })
      }
      return service
    })
  )

export const LiveGiftCardPayment: Layer.Layer<GiftCardPayment, never, Database> =
  Layer.effect(
    GiftCardPayment,
    Effect.gen(function* () {
      const db = yield* Database
      return {
        settle: (input) =>
          Effect.gen(function* () {
            const provider = yield* PaymentProvider
            if (
              provider.configuration.state !== 'configured' ||
              !provider.configuration.methods.includes(input.method)
            )
              return yield* new GiftCardSaleConflict({
                code: 'payment_method_unavailable'
              })
            const paymentId = `pay_${stableSuffix(input.sale.id)}`
            const attemptId = `pat_${stableSuffix(`${input.sale.id}:${input.idempotencyKey}`)}`
            const [existing] = yield* orUnavailable('gift-card-payment')(
              db.select().from(payments).where(eq(payments.id, paymentId)).limit(1)
            )
            if (existing?.status === 'captured')
              return { outcome: 'succeeded' as const, paymentId }
            yield* orUnavailable('gift-card-payment')(
              batch(db, [
                db
                  .insert(payments)
                  .values({
                    id: paymentId,
                    bookingPartyId: null,
                    pricingQuoteId: null,
                    amountMinor: input.sale.amountMinor,
                    currency: input.sale.currency,
                    createdAt: input.now,
                    updatedAt: input.now
                  })
                  .onConflictDoNothing(),
                db
                  .insert(paymentAttempts)
                  .values({
                    id: attemptId,
                    paymentId,
                    idempotencyKey: input.idempotencyKey,
                    provider: provider.configuration.provider,
                    method: input.method,
                    outcome: 'pending',
                    createdAt: input.now
                  })
                  .onConflictDoNothing(),
                db
                  .update(giftCardSales)
                  .set({ paymentId, updatedAt: input.now })
                  .where(eq(giftCardSales.id, input.sale.id))
              ])
            )
            const result = yield* provider.settle({
              payment: {
                id: paymentId,
                bookingPartyId: null,
                pricingQuoteId: null,
                amountMinor: input.sale.amountMinor,
                currency: input.sale.currency,
                status: 'pending',
                authorizedMinor: 0,
                capturedMinor: 0,
                refundedMinor: 0
              },
              attempt: {
                id: attemptId,
                paymentId,
                provider: provider.configuration.provider,
                method: input.method,
                idempotencyKey: input.idempotencyKey,
                outcome: 'pending',
                providerReference: null,
                failureCode: null
              },
              paymentMethodReference: input.paymentMethodReference,
              returnUrl: input.returnUrl
            })
            if (result.outcome === 'processing')
              return {
                outcome: 'processing' as const,
                paymentId,
                nextActionUrl: result.nextActionUrl ?? null
              }
            if (result.outcome === 'failed') {
              yield* orUnavailable('gift-card-payment')(
                db
                  .update(paymentAttempts)
                  .set({
                    outcome: 'failed',
                    providerReference: result.providerReference,
                    failureCode: result.failureCode ?? 'payment_failed',
                    completedAt: input.now
                  })
                  .where(eq(paymentAttempts.id, attemptId))
              )
              return {
                outcome: 'failed' as const,
                paymentId,
                failureCode: result.failureCode ?? 'payment_failed'
              }
            }
            const captures = result.facts.filter((fact) => fact.kind === 'capture')
            if (
              captures.length !== 1 ||
              captures[0]!.amountMinor !== input.sale.amountMinor ||
              captures[0]!.currency !== input.sale.currency
            )
              return yield* new GiftCardSaleConflict({
                code: 'payment_facts_invalid'
              })
            yield* orUnavailable('gift-card-payment')(
              batch(db, [
                ...result.facts.map((fact) =>
                  db
                    .insert(paymentTransactions)
                    .values({
                      id: `ptx_${stableSuffix(`${fact.kind}:${fact.providerReference}`)}`,
                      paymentId,
                      kind: fact.kind,
                      amountMinor: fact.amountMinor,
                      currency: fact.currency,
                      providerReference: fact.providerReference,
                      occurredAt: fact.occurredAt,
                      createdAt: input.now
                    })
                    .onConflictDoNothing()
                ),
                db
                  .update(paymentAttempts)
                  .set({
                    outcome: 'succeeded',
                    providerReference: result.providerReference,
                    completedAt: input.now
                  })
                  .where(eq(paymentAttempts.id, attemptId)),
                db
                  .update(payments)
                  .set({
                    status: 'captured',
                    capturedMinor: input.sale.amountMinor,
                    updatedAt: input.now
                  })
                  .where(eq(payments.id, paymentId)),
                db
                  .update(giftCardSales)
                  .set({ status: 'issuing', updatedAt: input.now })
                  .where(eq(giftCardSales.id, input.sale.id))
              ])
            )
            return { outcome: 'succeeded' as const, paymentId }
          })
      }
    })
  )
