import { Effect, Layer } from 'effect'
import { and, eq, gt, inArray, lte, ne, sql } from 'drizzle-orm'
import {
  batch,
  bookingParties,
  bookingRequests,
  Database,
  giftCardLedgerEntries,
  giftCardProducts,
  giftCardReservations,
  giftCardSales,
  giftCards,
  merchants,
  paymentAttempts,
  paymentTransactions,
  payments,
  providers,
  settlementAllocations,
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
import {
  GiftCardRedemptionConflict,
  GiftCardRedemptions,
  hashGiftCardRedemptionCode,
  type GiftCardReservation,
  type GiftCardSettlementPlan,
  type GiftCardRedemptionsShape
} from './gift-card-redemption.ts'

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

export const LiveGiftCardRedemptions: Layer.Layer<
  GiftCardRedemptions,
  never,
  Database
> = Layer.effect(
  GiftCardRedemptions,
  Effect.gen(function* () {
    const db = yield* Database
    const readBalance = (giftCardId: string) =>
      Effect.gen(function* () {
        const [card] = yield* orUnavailable('gift-card-redemptions')(
          db.select().from(giftCards).where(eq(giftCards.id, giftCardId)).limit(1)
        )
        if (!card)
          return yield* new GiftCardRedemptionConflict({
            code: 'gift_card_not_found'
          })
        const [{ balanceMinor } = { balanceMinor: 0 }] = yield* orUnavailable(
          'gift-card-redemptions'
        )(
          db
            .select({
              balanceMinor: sql<number>`coalesce(sum(${giftCardLedgerEntries.amountMinor}), 0)`
            })
            .from(giftCardLedgerEntries)
            .where(eq(giftCardLedgerEntries.giftCardId, giftCardId))
        )
        return {
          giftCardId,
          currency: card.currency,
          availableMinor: Number(balanceMinor)
        }
      })

    const reservationFrom = (
      row: typeof giftCardReservations.$inferSelect
    ): GiftCardReservation => ({ ...row })

    const readPlan = (input: {
      readonly bookingPartyId: string
      readonly quoteTotalMinor: number
      readonly currency: string
      readonly now: string
    }) =>
      Effect.gen(function* () {
        if (!Number.isSafeInteger(input.quoteTotalMinor) || input.quoteTotalMinor < 0)
          return yield* new GiftCardRedemptionConflict({
            code: 'invalid_quote_total'
          })
        const rows = yield* orUnavailable('gift-card-redemptions')(
          db
            .select()
            .from(giftCardReservations)
            .where(
              and(
                eq(giftCardReservations.bookingPartyId, input.bookingPartyId),
                eq(giftCardReservations.status, 'active'),
                gt(giftCardReservations.expiresAt, input.now)
              )
            )
        )
        if (rows.some((row) => row.currency !== input.currency))
          return yield* new GiftCardRedemptionConflict({ code: 'currency_mismatch' })
        const giftCardMinor = rows.reduce((sum, row) => sum + row.amountMinor, 0)
        if (giftCardMinor > input.quoteTotalMinor)
          return yield* new GiftCardRedemptionConflict({
            code: 'reservation_exceeds_quote'
          })
        return {
          bookingPartyId: input.bookingPartyId,
          quoteTotalMinor: input.quoteTotalMinor,
          giftCardMinor,
          externalPaymentMinor: input.quoteTotalMinor - giftCardMinor,
          currency: input.currency,
          allocations: rows.map((row) => ({
            tender: 'gift_card' as const,
            referenceId: row.giftCardId,
            reservationId: row.id,
            amountMinor: row.amountMinor,
            currency: row.currency
          }))
        } satisfies GiftCardSettlementPlan
      })

    const releaseRows = (
      rows: readonly (typeof giftCardReservations.$inferSelect)[],
      status: 'released' | 'expired',
      keyPrefix: string,
      now: string
    ) =>
      Effect.gen(function* () {
        if (rows.length === 0) return 0
        yield* orUnavailable('gift-card-redemptions')(
          batch(
            db,
            rows.flatMap((row) => [
              db
                .insert(giftCardLedgerEntries)
                .select(
                  db
                    .select({
                      id: sql<string>`${`gcl_${stableSuffix(`${keyPrefix}:${row.id}`)}`}`.as(
                        'id'
                      ),
                      giftCardId: giftCardReservations.giftCardId,
                      kind: sql<'release'>`'release'`.as('kind'),
                      amountMinor: giftCardReservations.amountMinor,
                      bookingPartyId: giftCardReservations.bookingPartyId,
                      idempotencyKey: sql<string>`${`${keyPrefix}:${row.id}`}`.as(
                        'idempotency_key'
                      ),
                      occurredAt: sql<string>`${now}`.as('occurred_at'),
                      createdAt: sql<string>`${now}`.as('created_at')
                    })
                    .from(giftCardReservations)
                    .where(
                      and(
                        eq(giftCardReservations.id, row.id),
                        eq(giftCardReservations.status, 'active')
                      )
                    )
                )
                .onConflictDoNothing(),
              db
                .update(giftCardReservations)
                .set({ status, updatedAt: now })
                .where(
                  and(
                    eq(giftCardReservations.id, row.id),
                    eq(giftCardReservations.status, 'active')
                  )
                )
            ])
          )
        )
        return rows.length
      })

    const expireReservations = (now: string) =>
      Effect.gen(function* () {
        const rows = yield* orUnavailable('gift-card-redemptions')(
          db
            .select()
            .from(giftCardReservations)
            .where(
              and(
                eq(giftCardReservations.status, 'active'),
                lte(giftCardReservations.expiresAt, now)
              )
            )
        )
        return yield* releaseRows(rows, 'expired', `expiry:${now}`, now)
      })

    const service: GiftCardRedemptionsShape = {
      balance: readBalance,
      reserve: (input) =>
        Effect.gen(function* () {
          yield* expireReservations(input.now)
          const codeHash = yield* hashGiftCardRedemptionCode(input.giftCardCode)
          const id = `gcr_${stableSuffix(input.idempotencyKey)}`
          const [replay] = yield* orUnavailable('gift-card-redemptions')(
            db
              .select()
              .from(giftCardReservations)
              .where(eq(giftCardReservations.id, id))
              .limit(1)
          )
          if (replay) {
            const [replayCard] = yield* orUnavailable('gift-card-redemptions')(
              db
                .select({ codeHash: giftCards.codeHash })
                .from(giftCards)
                .where(eq(giftCards.id, replay.giftCardId))
                .limit(1)
            )
            if (
              replayCard?.codeHash !== codeHash ||
              replay.bookingPartyId !== input.bookingPartyId ||
              replay.amountMinor !== input.amountMinor
            )
              return yield* new GiftCardRedemptionConflict({
                code: 'idempotency_key_reused'
              })
            return reservationFrom(replay)
          }
          if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0)
            return yield* new GiftCardRedemptionConflict({ code: 'invalid_amount' })
          if (input.amountMinor > input.maximumAmountMinor)
            return yield* new GiftCardRedemptionConflict({
              code: 'reservation_exceeds_quote'
            })
          if (input.expiresAt <= input.now)
            return yield* new GiftCardRedemptionConflict({
              code: 'reservation_expired'
            })
          const [card] = yield* orUnavailable('gift-card-redemptions')(
            db.select().from(giftCards).where(eq(giftCards.codeHash, codeHash)).limit(1)
          )
          if (!card)
            return yield* new GiftCardRedemptionConflict({
              code: 'gift_card_not_found'
            })
          if (
            card.status !== 'active' ||
            (card.expiresAt !== null && card.expiresAt <= input.now)
          )
            return yield* new GiftCardRedemptionConflict({
              code: 'gift_card_unavailable'
            })
          const [party] = yield* orUnavailable('gift-card-redemptions')(
            db
              .select()
              .from(bookingParties)
              .where(eq(bookingParties.id, input.bookingPartyId))
              .limit(1)
          )
          if (
            !party ||
            party.lifecycle !== 'active' ||
            party.currency !== card.currency
          )
            return yield* new GiftCardRedemptionConflict({
              code: 'booking_party_unavailable'
            })
          const [shop] = yield* orUnavailable('gift-card-redemptions')(
            db.select().from(shops).where(eq(shops.id, party.shopId)).limit(1)
          )
          const requests = yield* orUnavailable('gift-card-redemptions')(
            db
              .select({ providerId: bookingRequests.providerId })
              .from(bookingRequests)
              .where(eq(bookingRequests.bookingPartyId, party.id))
          )
          const scopeMatches =
            !!shop &&
            (card.scope === 'merchant'
              ? card.scopeId === shop.merchantId
              : card.scope === 'brand'
                ? card.scopeId === shop.brandId
                : card.scope === 'shop'
                  ? card.scopeId === shop.id
                  : requests.length > 0 &&
                    requests.every(({ providerId }) => providerId === card.scopeId))
          if (!scopeMatches)
            return yield* new GiftCardRedemptionConflict({ code: 'scope_mismatch' })
          const [terminalReservation] = yield* orUnavailable('gift-card-redemptions')(
            db
              .select()
              .from(giftCardReservations)
              .where(
                and(
                  eq(giftCardReservations.giftCardId, card.id),
                  eq(giftCardReservations.bookingPartyId, input.bookingPartyId)
                )
              )
              .limit(1)
          )
          if (
            terminalReservation?.status === 'active' ||
            terminalReservation?.status === 'committed'
          )
            return yield* new GiftCardRedemptionConflict({
              code: 'reservation_exists'
            })
          const makeLedgerInsert = () =>
            db.insert(giftCardLedgerEntries).select(
              db
                .select({
                  id: sql<string>`${`gcl_${stableSuffix(`reservation:${input.idempotencyKey}`)}`}`.as(
                    'id'
                  ),
                  giftCardId: giftCardReservations.giftCardId,
                  kind: sql<'reservation'>`'reservation'`.as('kind'),
                  amountMinor: sql<number>`${-input.amountMinor}`.as('amount_minor'),
                  bookingPartyId: giftCardReservations.bookingPartyId,
                  idempotencyKey:
                    sql<string>`${`reservation:${input.idempotencyKey}`}`.as(
                      'idempotency_key'
                    ),
                  occurredAt: sql<string>`${input.now}`.as('occurred_at'),
                  createdAt: sql<string>`${input.now}`.as('created_at')
                })
                .from(giftCardReservations)
                .where(
                  and(
                    eq(giftCardReservations.id, id),
                    eq(giftCardReservations.status, 'active')
                  )
                )
            )
          if (terminalReservation) {
            const balance = yield* readBalance(card.id)
            if (balance.availableMinor < input.amountMinor)
              return yield* new GiftCardRedemptionConflict({
                code: 'insufficient_balance'
              })
            yield* orUnavailable('gift-card-redemptions')(
              batch(db, [
                db
                  .update(giftCardReservations)
                  .set({
                    id,
                    amountMinor: input.amountMinor,
                    currency: card.currency,
                    status: 'active',
                    expiresAt: input.expiresAt,
                    createdAt: input.now,
                    updatedAt: input.now
                  })
                  .where(
                    and(
                      eq(giftCardReservations.id, terminalReservation.id),
                      ne(giftCardReservations.status, 'active'),
                      ne(giftCardReservations.status, 'committed'),
                      sql`(select coalesce(sum(${giftCardLedgerEntries.amountMinor}), 0) from ${giftCardLedgerEntries} where ${giftCardLedgerEntries.giftCardId} = ${card.id}) >= ${input.amountMinor}`,
                      sql`(select coalesce(sum(${giftCardReservations.amountMinor}), 0) from ${giftCardReservations} where ${giftCardReservations.bookingPartyId} = ${input.bookingPartyId} and ${giftCardReservations.status} = 'active' and ${giftCardReservations.expiresAt} > ${input.now}) + ${input.amountMinor} <= ${input.maximumAmountMinor}`
                    )
                  ),
                makeLedgerInsert()
              ])
            )
            const [reactivated] = yield* orUnavailable('gift-card-redemptions')(
              db
                .select()
                .from(giftCardReservations)
                .where(eq(giftCardReservations.id, id))
                .limit(1)
            )
            if (!reactivated)
              return yield* new GiftCardRedemptionConflict({
                code: 'reservation_exists'
              })
            return reservationFrom(reactivated)
          }
          const reservationInsert = db.insert(giftCardReservations).select(
            db
              .select({
                id: sql<string>`${id}`.as('id'),
                giftCardId: giftCards.id,
                bookingPartyId: sql<string>`${input.bookingPartyId}`.as(
                  'booking_party_id'
                ),
                amountMinor: sql<number>`${input.amountMinor}`.as('amount_minor'),
                currency: giftCards.currency,
                status: sql<'active'>`'active'`.as('status'),
                expiresAt: sql<string>`${input.expiresAt}`.as('expires_at'),
                createdAt: sql<string>`${input.now}`.as('created_at'),
                updatedAt: sql<string>`${input.now}`.as('updated_at')
              })
              .from(giftCards)
              .where(
                and(
                  eq(giftCards.id, card.id),
                  eq(giftCards.status, 'active'),
                  eq(giftCards.currency, card.currency),
                  sql`(${giftCards.expiresAt} is null or ${giftCards.expiresAt} > ${input.now})`,
                  sql`(select coalesce(sum(${giftCardLedgerEntries.amountMinor}), 0) from ${giftCardLedgerEntries} where ${giftCardLedgerEntries.giftCardId} = ${card.id}) >= ${input.amountMinor}`,
                  sql`(select coalesce(sum(${giftCardReservations.amountMinor}), 0) from ${giftCardReservations} where ${giftCardReservations.bookingPartyId} = ${input.bookingPartyId} and ${giftCardReservations.status} = 'active' and ${giftCardReservations.expiresAt} > ${input.now}) + ${input.amountMinor} <= ${input.maximumAmountMinor}`,
                  sql`not exists (select 1 from ${giftCardReservations} where ${giftCardReservations.giftCardId} = ${card.id} and ${giftCardReservations.bookingPartyId} = ${input.bookingPartyId})`
                )
              )
          )
          const ledgerInsert = makeLedgerInsert()
          yield* orUnavailable('gift-card-redemptions')(
            batch(db, [reservationInsert, ledgerInsert])
          )
          const [created] = yield* orUnavailable('gift-card-redemptions')(
            db
              .select()
              .from(giftCardReservations)
              .where(eq(giftCardReservations.id, id))
              .limit(1)
          )
          if (!created) {
            const balance = yield* readBalance(card.id)
            return yield* new GiftCardRedemptionConflict({
              code:
                balance.availableMinor < input.amountMinor
                  ? 'insufficient_balance'
                  : 'reservation_exists'
            })
          }
          return reservationFrom(created)
        }),
      release: (input) =>
        Effect.gen(function* () {
          const rows = yield* orUnavailable('gift-card-redemptions')(
            db
              .select()
              .from(giftCardReservations)
              .where(
                and(
                  eq(giftCardReservations.bookingPartyId, input.bookingPartyId),
                  eq(giftCardReservations.status, 'active')
                )
              )
          )
          return yield* releaseRows(
            rows,
            'released',
            `release:${input.idempotencyKey}`,
            input.now
          )
        }),
      releaseExpired: (input) => expireReservations(input.now),
      planSettlement: (input) =>
        Effect.gen(function* () {
          yield* expireReservations(input.now)
          return yield* readPlan(input)
        }),
      refund: (input) =>
        Effect.gen(function* () {
          const allocations = yield* orUnavailable('gift-card-redemptions')(
            db
              .select()
              .from(settlementAllocations)
              .where(eq(settlementAllocations.bookingPartyId, input.bookingPartyId))
          )
          if (allocations.length === 0)
            return yield* new GiftCardRedemptionConflict({
              code: 'settlement_not_found'
            })
          const giftRows = allocations.filter(
            (allocation) => allocation.tender === 'gift_card'
          )
          const refundResult = {
            bookingPartyId: input.bookingPartyId,
            restoredGiftCardMinor: giftRows.reduce(
              (sum, allocation) => sum + allocation.amountMinor,
              0
            ),
            externalPaymentMinor: allocations
              .filter((allocation) => allocation.tender === 'external_payment')
              .reduce((sum, allocation) => sum + allocation.amountMinor, 0),
            currency: allocations[0]!.currency
          }
          const existingRefunds = yield* orUnavailable('gift-card-redemptions')(
            db
              .select({ idempotencyKey: giftCardLedgerEntries.idempotencyKey })
              .from(giftCardLedgerEntries)
              .where(
                and(
                  eq(giftCardLedgerEntries.bookingPartyId, input.bookingPartyId),
                  eq(giftCardLedgerEntries.kind, 'refund')
                )
              )
          )
          if (
            existingRefunds.length === giftRows.length &&
            existingRefunds.every(({ idempotencyKey }) =>
              idempotencyKey.startsWith(`refund:${input.idempotencyKey}:`)
            )
          )
            return refundResult
          if (existingRefunds.length > 0)
            return yield* new GiftCardRedemptionConflict({
              code: 'settlement_already_refunded'
            })
          yield* orUnavailable('gift-card-redemptions')(
            batch(
              db,
              giftRows.map((allocation) =>
                db
                  .insert(giftCardLedgerEntries)
                  .select(
                    db
                      .select({
                        id: sql<string>`${`gcl_${stableSuffix(`refund:${input.idempotencyKey}:${allocation.id}`)}`}`.as(
                          'id'
                        ),
                        giftCardId: sql<string>`${allocation.referenceId!}`.as(
                          'gift_card_id'
                        ),
                        kind: sql<'refund'>`'refund'`.as('kind'),
                        amountMinor: settlementAllocations.amountMinor,
                        bookingPartyId: settlementAllocations.bookingPartyId,
                        idempotencyKey:
                          sql<string>`${`refund:${input.idempotencyKey}:${allocation.id}`}`.as(
                            'idempotency_key'
                          ),
                        occurredAt: sql<string>`${input.now}`.as('occurred_at'),
                        createdAt: sql<string>`${input.now}`.as('created_at')
                      })
                      .from(settlementAllocations)
                      .where(
                        and(
                          eq(settlementAllocations.id, allocation.id),
                          sql`not exists (select 1 from ${giftCardLedgerEntries} where ${giftCardLedgerEntries.bookingPartyId} = ${input.bookingPartyId} and ${giftCardLedgerEntries.giftCardId} = ${allocation.referenceId!} and ${giftCardLedgerEntries.kind} = 'refund')`
                        )
                      )
                  )
                  .onConflictDoNothing()
              )
            )
          )
          const storedRefunds = yield* orUnavailable('gift-card-redemptions')(
            db
              .select({ idempotencyKey: giftCardLedgerEntries.idempotencyKey })
              .from(giftCardLedgerEntries)
              .where(
                and(
                  eq(giftCardLedgerEntries.bookingPartyId, input.bookingPartyId),
                  eq(giftCardLedgerEntries.kind, 'refund')
                )
              )
          )
          if (
            storedRefunds.length !== giftRows.length ||
            !storedRefunds.every(({ idempotencyKey }) =>
              idempotencyKey.startsWith(`refund:${input.idempotencyKey}:`)
            )
          )
            return yield* new GiftCardRedemptionConflict({
              code: 'settlement_already_refunded'
            })
          return refundResult
        })
    }
    return service
  })
)

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
          if (
            !sale ||
            (sale.status !== 'issued' && sale.status !== 'refunded') ||
            !sale.giftCardProductId
          )
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
            const codeHash = yield* hashGiftCardRedemptionCode(cardId)
            const issuanceKey = `gift-card-issuance:${sale.id}`
            yield* orUnavailable('gift-card-sales')(
              batch(db, [
                db
                  .insert(giftCards)
                  .values({
                    id: cardId,
                    giftCardSaleId: sale.id,
                    codeHash,
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
        exchangeReceiptAccess: (input) =>
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
              sale.tokenHash !== input.presentedTokenHash ||
              !sale.expiresAt ||
              sale.expiresAt <= input.now
            )
              return yield* new GiftCardSaleConflict({ code: 'receipt_not_found' })
            yield* orUnavailable('gift-card-sales')(
              db
                .update(giftCardSales)
                .set({
                  receiptTokenHash: input.cookieTokenHash,
                  updatedAt: input.now
                })
                .where(eq(giftCardSales.id, sale.id))
            )
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
            const [payment] = yield* orUnavailable('gift-card-sales')(
              db
                .select()
                .from(payments)
                .where(eq(payments.id, input.paymentId))
                .limit(1)
            )
            if (!payment) return null
            if (payment.status === 'cancelled') {
              yield* orUnavailable('gift-card-sales')(
                db
                  .update(giftCardSales)
                  .set({ status: 'cancelled', updatedAt: input.now })
                  .where(eq(giftCardSales.id, sale.id))
              )
              return null
            }
            if (payment.status === 'refunded') {
              const [card] = yield* orUnavailable('gift-card-sales')(
                db
                  .select()
                  .from(giftCards)
                  .where(eq(giftCards.giftCardSaleId, sale.id))
                  .limit(1)
              )
              if (!card) return null
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
              const remainingMinor = Number(balanceMinor)
              if (
                remainingMinor !== card.initialValueMinor &&
                input.spentValueAdjustment !== 'merchant_liability'
              )
                return yield* new GiftCardSaleConflict({
                  code: 'spent_value_requires_adjustment'
                })
              const refundKey = `gift-card-refund:${sale.id}`
              yield* orUnavailable('gift-card-sales')(
                batch(db, [
                  ...(remainingMinor > 0
                    ? [
                        db
                          .insert(giftCardLedgerEntries)
                          .values({
                            id: `gcl_${stableSuffix(refundKey)}`,
                            giftCardId: card.id,
                            kind: 'refund',
                            amountMinor: -remainingMinor,
                            idempotencyKey:
                              input.spentValueAdjustment === 'merchant_liability'
                                ? `${refundKey}:merchant-liability`
                                : refundKey,
                            occurredAt: input.now,
                            createdAt: input.now
                          })
                          .onConflictDoNothing()
                      ]
                    : []),
                  db
                    .update(giftCards)
                    .set({ status: 'voided', updatedAt: input.now })
                    .where(eq(giftCards.id, card.id)),
                  db
                    .update(giftCardSales)
                    .set({ status: 'refunded', updatedAt: input.now })
                    .where(eq(giftCardSales.id, sale.id))
                ])
              )
              return yield* readReceiptBySale(sale.id)
            }
            if (payment.status !== 'captured') return null
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
