import { Context, Effect, Layer, Schema } from 'effect'
import { CapabilityUnavailable } from '../errors.ts'

export type GiftCardLedgerKind =
  | 'issuance'
  | 'reservation'
  | 'release'
  | 'redemption'
  | 'refund'
  | 'adjustment'

export type GiftCardLedgerEntry = {
  readonly id: string
  readonly giftCardId: string
  readonly bookingPartyId: string | null
  readonly kind: GiftCardLedgerKind
  readonly amountMinor: number
  readonly idempotencyKey: string
  readonly occurredAt: string
}

export type RedeemableGiftCard = {
  readonly id: string
  readonly codeHash: string
  readonly status: 'active' | 'suspended' | 'expired' | 'voided'
  readonly currency: string
  readonly scope: 'merchant' | 'brand' | 'shop' | 'provider'
  readonly scopeId: string
  readonly expiresAt: string | null
  readonly initialValueMinor: number
}

export type GiftCardReservation = {
  readonly id: string
  readonly giftCardId: string
  readonly bookingPartyId: string
  readonly amountMinor: number
  readonly currency: string
  readonly status: 'active' | 'committed' | 'released' | 'expired'
  readonly expiresAt: string
  readonly createdAt: string
  readonly updatedAt: string
}

export type GiftCardSettlementAllocation = {
  readonly tender: 'gift_card' | 'external_payment'
  readonly referenceId: string
  readonly reservationId: string | null
  readonly amountMinor: number
  readonly currency: string
}

export type GiftCardSettlementPlan = {
  readonly bookingPartyId: string
  readonly quoteTotalMinor: number
  readonly giftCardMinor: number
  readonly externalPaymentMinor: number
  readonly currency: string
  readonly allocations: readonly GiftCardSettlementAllocation[]
}

export class GiftCardRedemptionConflict extends Schema.TaggedErrorClass<GiftCardRedemptionConflict>()(
  'GiftCardRedemptionConflict',
  {
    code: Schema.Literals([
      'booking_party_unavailable',
      'currency_mismatch',
      'gift_card_not_found',
      'gift_card_unavailable',
      'idempotency_key_reused',
      'insufficient_balance',
      'invalid_amount',
      'invalid_quote_total',
      'refund_failed',
      'reservation_exceeds_quote',
      'reservation_exists',
      'reservation_expired',
      'reservation_failed',
      'scope_mismatch',
      'settlement_already_refunded',
      'settlement_invalid',
      'settlement_not_found'
    ])
  }
) {}

type RedemptionError = GiftCardRedemptionConflict | CapabilityUnavailable

export type GiftCardRedemptionsShape = {
  readonly balance: (giftCardId: string) => Effect.Effect<
    {
      readonly giftCardId: string
      readonly currency: string
      readonly availableMinor: number
    },
    RedemptionError
  >
  readonly reserve: (input: {
    readonly giftCardCode: string
    readonly bookingPartyId: string
    readonly amountMinor: number
    readonly maximumAmountMinor: number
    readonly expiresAt: string
    readonly idempotencyKey: string
    readonly now: string
  }) => Effect.Effect<GiftCardReservation, RedemptionError>
  readonly release: (input: {
    readonly bookingPartyId: string
    readonly idempotencyKey: string
    readonly now: string
  }) => Effect.Effect<number, RedemptionError>
  readonly releaseExpired: (input: {
    readonly now: string
  }) => Effect.Effect<number, RedemptionError>
  readonly planSettlement: (input: {
    readonly bookingPartyId: string
    readonly quoteTotalMinor: number
    readonly currency: string
    readonly now: string
  }) => Effect.Effect<GiftCardSettlementPlan, RedemptionError>
  readonly refund: (input: {
    readonly bookingPartyId: string
    readonly idempotencyKey: string
    readonly now: string
  }) => Effect.Effect<
    {
      readonly bookingPartyId: string
      readonly restoredGiftCardMinor: number
      readonly externalPaymentMinor: number
      readonly currency: string
    },
    RedemptionError
  >
}

export class GiftCardRedemptions extends Context.Service<
  GiftCardRedemptions,
  GiftCardRedemptionsShape
>()('@b2b-saas-starter/capabilities/GiftCardRedemptions') {}

export type SeedGiftCardRedemptionStore = {
  readonly cards: Map<string, RedeemableGiftCard>
  readonly ledger: GiftCardLedgerEntry[]
  readonly reservations: Map<string, GiftCardReservation>
  readonly reservationKeys: Map<string, string>
  readonly settlementPlans: Map<string, GiftCardSettlementPlan>
  readonly eligibleScopes: Map<
    string,
    {
      readonly merchantId: string
      readonly brandId: string
      readonly shopId: string
      readonly providerIds: readonly string[]
    }
  >
  readonly refunds: Map<
    string,
    {
      readonly bookingPartyId: string
      readonly restoredGiftCardMinor: number
      readonly externalPaymentMinor: number
      readonly currency: string
    }
  >
}

export const emptySeedGiftCardRedemptionStore = (
  input: {
    readonly cards?: readonly RedeemableGiftCard[]
    readonly ledger?: readonly GiftCardLedgerEntry[]
    readonly settlementPlans?: readonly GiftCardSettlementPlan[]
    readonly eligibleScopes?: readonly [
      string,
      {
        readonly merchantId: string
        readonly brandId: string
        readonly shopId: string
        readonly providerIds: readonly string[]
      }
    ][]
  } = {}
): SeedGiftCardRedemptionStore => ({
  cards: new Map((input.cards ?? []).map((card) => [card.id, card])),
  ledger: [...(input.ledger ?? [])],
  reservations: new Map(),
  reservationKeys: new Map(),
  settlementPlans: new Map(
    (input.settlementPlans ?? []).map((plan) => [plan.bookingPartyId, plan])
  ),
  eligibleScopes: new Map(input.eligibleScopes ?? []),
  refunds: new Map()
})

const stableSuffix = (value: string) => {
  let hash = 2166136261
  for (const character of value)
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  return (hash >>> 0).toString(36)
}

export const hashGiftCardRedemptionCode = (code: string) =>
  Effect.promise(async () => {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(code.trim().toUpperCase())
    )
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('')
  })

const cardCoversParty = (
  card: RedeemableGiftCard,
  topology: {
    readonly merchantId: string
    readonly brandId: string
    readonly shopId: string
    readonly providerIds: readonly string[]
  }
) =>
  card.scope === 'merchant'
    ? card.scopeId === topology.merchantId
    : card.scope === 'brand'
      ? card.scopeId === topology.brandId
      : card.scope === 'shop'
        ? card.scopeId === topology.shopId
        : topology.providerIds.length > 0 &&
          topology.providerIds.every((providerId) => providerId === card.scopeId)

const balanceFrom = (store: SeedGiftCardRedemptionStore, giftCardId: string) =>
  store.ledger
    .filter((entry) => entry.giftCardId === giftCardId)
    .reduce((sum, entry) => sum + entry.amountMinor, 0)

const activeReservations = (
  store: SeedGiftCardRedemptionStore,
  bookingPartyId: string,
  now: string
) =>
  [...store.reservations.values()].filter(
    (reservation) =>
      reservation.bookingPartyId === bookingPartyId &&
      reservation.status === 'active' &&
      reservation.expiresAt > now
  )

const planFor = (
  store: SeedGiftCardRedemptionStore,
  input: {
    readonly bookingPartyId: string
    readonly quoteTotalMinor: number
    readonly currency: string
    readonly now: string
  }
): GiftCardSettlementPlan => {
  if (!Number.isSafeInteger(input.quoteTotalMinor) || input.quoteTotalMinor < 0)
    throw new GiftCardRedemptionConflict({ code: 'invalid_quote_total' })
  const reservations = activeReservations(store, input.bookingPartyId, input.now)
  if (reservations.some((reservation) => reservation.currency !== input.currency))
    throw new GiftCardRedemptionConflict({ code: 'currency_mismatch' })
  const giftCardMinor = reservations.reduce(
    (sum, reservation) => sum + reservation.amountMinor,
    0
  )
  if (giftCardMinor > input.quoteTotalMinor)
    throw new GiftCardRedemptionConflict({ code: 'reservation_exceeds_quote' })
  return {
    bookingPartyId: input.bookingPartyId,
    quoteTotalMinor: input.quoteTotalMinor,
    giftCardMinor,
    externalPaymentMinor: input.quoteTotalMinor - giftCardMinor,
    currency: input.currency,
    allocations: reservations.map((reservation) => ({
      tender: 'gift_card' as const,
      referenceId: reservation.giftCardId,
      reservationId: reservation.id,
      amountMinor: reservation.amountMinor,
      currency: reservation.currency
    }))
  }
}

export const SeedGiftCardRedemptions = (
  store = emptySeedGiftCardRedemptionStore()
): Layer.Layer<GiftCardRedemptions> => {
  const releaseReservations = (
    reservations: readonly GiftCardReservation[],
    status: 'released' | 'expired',
    keyPrefix: string,
    now: string
  ) => {
    for (const reservation of reservations) {
      store.ledger.push({
        id: `gcl_${stableSuffix(`${keyPrefix}:${reservation.id}`)}`,
        giftCardId: reservation.giftCardId,
        bookingPartyId: reservation.bookingPartyId,
        kind: 'release',
        amountMinor: reservation.amountMinor,
        idempotencyKey: `${keyPrefix}:${reservation.id}`,
        occurredAt: now
      })
      store.reservations.set(reservation.id, {
        ...reservation,
        status,
        updatedAt: now
      })
    }
    return reservations.length
  }

  const service: GiftCardRedemptionsShape = {
    balance: (giftCardId) => {
      const card = store.cards.get(giftCardId)
      return card
        ? Effect.succeed({
            giftCardId,
            currency: card.currency,
            availableMinor: balanceFrom(store, giftCardId)
          })
        : Effect.fail(new GiftCardRedemptionConflict({ code: 'gift_card_not_found' }))
    },
    reserve: (input) =>
      Effect.gen(function* () {
        const codeHash = yield* hashGiftCardRedemptionCode(input.giftCardCode)
        return yield* Effect.try({
          try: () => {
            const replayId = store.reservationKeys.get(input.idempotencyKey)
            if (replayId) {
              const replay = store.reservations.get(replayId)!
              if (
                store.cards.get(replay.giftCardId)?.codeHash !== codeHash ||
                replay.bookingPartyId !== input.bookingPartyId ||
                replay.amountMinor !== input.amountMinor
              )
                throw new GiftCardRedemptionConflict({
                  code: 'idempotency_key_reused'
                })
              return replay
            }
            if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0)
              throw new GiftCardRedemptionConflict({ code: 'invalid_amount' })
            if (input.amountMinor > input.maximumAmountMinor)
              throw new GiftCardRedemptionConflict({
                code: 'reservation_exceeds_quote'
              })
            const reservedForParty = activeReservations(
              store,
              input.bookingPartyId,
              input.now
            ).reduce((sum, reservation) => sum + reservation.amountMinor, 0)
            if (reservedForParty + input.amountMinor > input.maximumAmountMinor)
              throw new GiftCardRedemptionConflict({
                code: 'reservation_exceeds_quote'
              })
            if (input.expiresAt <= input.now)
              throw new GiftCardRedemptionConflict({ code: 'reservation_expired' })
            const card = [...store.cards.values()].find(
              (candidate) => candidate.codeHash === codeHash
            )
            if (!card)
              throw new GiftCardRedemptionConflict({ code: 'gift_card_not_found' })
            if (
              card.status !== 'active' ||
              (card.expiresAt !== null && card.expiresAt <= input.now)
            )
              throw new GiftCardRedemptionConflict({ code: 'gift_card_unavailable' })
            const topology = store.eligibleScopes.get(input.bookingPartyId)
            if (!topology || !cardCoversParty(card, topology))
              throw new GiftCardRedemptionConflict({ code: 'scope_mismatch' })
            if (balanceFrom(store, card.id) < input.amountMinor)
              throw new GiftCardRedemptionConflict({ code: 'insufficient_balance' })
            const existing = [...store.reservations.values()].find(
              (reservation) =>
                reservation.giftCardId === card.id &&
                reservation.bookingPartyId === input.bookingPartyId
            )
            const id = `gcr_${stableSuffix(input.idempotencyKey)}`
            const reservation: GiftCardReservation = {
              id,
              giftCardId: card.id,
              bookingPartyId: input.bookingPartyId,
              amountMinor: input.amountMinor,
              currency: card.currency,
              status: 'active',
              expiresAt: input.expiresAt,
              createdAt: input.now,
              updatedAt: input.now
            }
            if (
              existing &&
              (existing.status === 'active' || existing.status === 'committed')
            )
              throw new GiftCardRedemptionConflict({ code: 'reservation_exists' })
            store.ledger.push({
              id: `gcl_${stableSuffix(`reservation:${input.idempotencyKey}`)}`,
              giftCardId: card.id,
              bookingPartyId: input.bookingPartyId,
              kind: 'reservation',
              amountMinor: -input.amountMinor,
              idempotencyKey: `reservation:${input.idempotencyKey}`,
              occurredAt: input.now
            })
            if (existing) {
              store.reservations.delete(existing.id)
            }
            store.reservations.set(id, reservation)
            store.reservationKeys.set(input.idempotencyKey, id)
            return reservation
          },
          catch: (cause) =>
            cause instanceof GiftCardRedemptionConflict
              ? cause
              : new GiftCardRedemptionConflict({ code: 'reservation_failed' })
        })
      }),
    release: (input) =>
      Effect.sync(() =>
        releaseReservations(
          [...store.reservations.values()].filter(
            (reservation) =>
              reservation.bookingPartyId === input.bookingPartyId &&
              reservation.status === 'active'
          ),
          'released',
          `release:${input.idempotencyKey}`,
          input.now
        )
      ),
    releaseExpired: (input) =>
      Effect.sync(() =>
        releaseReservations(
          [...store.reservations.values()].filter(
            (reservation) =>
              reservation.status === 'active' && reservation.expiresAt <= input.now
          ),
          'expired',
          `expiry:${input.now}`,
          input.now
        )
      ),
    planSettlement: (input) =>
      Effect.try({
        try: () => planFor(store, input),
        catch: (cause) =>
          cause instanceof GiftCardRedemptionConflict
            ? cause
            : new GiftCardRedemptionConflict({ code: 'settlement_invalid' })
      }),
    refund: (input) =>
      Effect.try({
        try: () => {
          const replay = store.refunds.get(input.idempotencyKey)
          if (replay) {
            if (replay.bookingPartyId !== input.bookingPartyId)
              throw new GiftCardRedemptionConflict({ code: 'idempotency_key_reused' })
            return replay
          }
          const committed = store.settlementPlans.get(input.bookingPartyId)
          if (!committed)
            throw new GiftCardRedemptionConflict({ code: 'settlement_not_found' })
          if (
            [...store.refunds.values()].some(
              (refund) => refund.bookingPartyId === input.bookingPartyId
            )
          )
            throw new GiftCardRedemptionConflict({
              code: 'settlement_already_refunded'
            })
          for (const allocation of committed.allocations) {
            if (allocation.tender !== 'gift_card') continue
            store.ledger.push({
              id: `gcl_${stableSuffix(`refund:${input.idempotencyKey}:${allocation.reservationId}`)}`,
              giftCardId: allocation.referenceId,
              bookingPartyId: input.bookingPartyId,
              kind: 'refund',
              amountMinor: allocation.amountMinor,
              idempotencyKey: `refund:${input.idempotencyKey}:${allocation.reservationId}`,
              occurredAt: input.now
            })
          }
          const result = {
            bookingPartyId: input.bookingPartyId,
            restoredGiftCardMinor: committed.giftCardMinor,
            externalPaymentMinor: committed.externalPaymentMinor,
            currency: committed.currency
          }
          store.refunds.set(input.idempotencyKey, result)
          return result
        },
        catch: (cause) =>
          cause instanceof GiftCardRedemptionConflict
            ? cause
            : new GiftCardRedemptionConflict({ code: 'refund_failed' })
      })
  }
  return Layer.succeed(GiftCardRedemptions)(service)
}
