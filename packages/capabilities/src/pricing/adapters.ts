import { Effect, Layer, Semaphore } from 'effect'
import { and, desc, eq, sql } from 'drizzle-orm'
import {
  batch,
  type BatchStatement,
  bookingParties,
  bookingRequests,
  bookingRequestServices,
  bookingSessions,
  checkoutPolicies,
  Database,
  giftCardReservations,
  pricingAdjustments,
  pricingPolicies,
  pricingQuoteAcceptances,
  pricingQuotes,
  promotionReservations,
  promotions,
  services,
  timeSlotHolds
} from '@b2b-saas-starter/db'
import { orUnavailable } from '../internal/unavailable.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { CapabilityUnavailable } from '../errors.ts'
import {
  allocateMinor,
  InvalidQuoteMaterial,
  type PricingAdjustment,
  type PricingQuote,
  PricingQuoteNotFound,
  PricingQuotes,
  type Promotion,
  PromotionUnavailable,
  QuoteUnconfirmable,
  type QuoteMaterial
} from './index.ts'

type PromotionReservation = {
  id: string
  promotionId: string
  quoteId: string
  expiresAt: string
  status: 'active' | 'committed' | 'released' | 'expired'
}
export type PricingRules = {
  readonly taxBasisPoints: number
  readonly feeMinor: number
  readonly taxLabel: string
  readonly feeLabel: string
  readonly version: number
}
const noPricingRules: PricingRules = {
  taxBasisPoints: 0,
  feeMinor: 0,
  taxLabel: 'Tax',
  feeLabel: 'Fee',
  version: 0
}

const validateMaterial = (material: QuoteMaterial) => {
  if (!Number.isSafeInteger(material.tipMinor) || material.tipMinor < 0)
    return 'tip must be a non-negative integer'
  if (material.lines.length === 0) return 'at least one request is required'
  if (
    new Set(material.lines.map((line) => line.requestId)).size !== material.lines.length
  )
    return 'request identities must be unique'
  if (
    material.lines.some(
      (line) =>
        !Number.isSafeInteger(line.amountMinor) ||
        line.amountMinor <= 0 ||
        line.serviceIds.length === 0
    )
  )
    return 'each request must have services and a positive integer amount'
  if (material.expiresAt <= material.now) return 'quote expiry must be in the future'
  return null
}

const promotionAmount = (promotion: Promotion, subtotalMinor: number) =>
  -Math.min(
    subtotalMinor,
    promotion.kind === 'fixed'
      ? promotion.value
      : Math.floor((subtotalMinor * promotion.value) / 10_000)
  )

const buildQuote = (input: {
  material: QuoteMaterial
  id: string
  version: number
  promotion?: Promotion | undefined
  promotionReservationId?: string | undefined
  rules: PricingRules
}): PricingQuote => {
  const { material, promotion } = input
  const subtotalMinor = material.lines.reduce((sum, line) => sum + line.amountMinor, 0)
  const adjustments: PricingAdjustment[] = []
  if (promotion) {
    const amountMinor = promotionAmount(promotion, subtotalMinor)
    adjustments.push({
      id: newCapabilityId('pad'),
      kind: 'discount',
      label: promotion.label,
      amountMinor,
      allocation: allocateMinor(amountMinor, material.lines)
    })
  }
  const discountedSubtotal =
    subtotalMinor + adjustments.reduce((sum, item) => sum + item.amountMinor, 0)
  const taxMinor = Math.floor(
    (discountedSubtotal * input.rules.taxBasisPoints) / 10_000
  )
  if (taxMinor > 0)
    adjustments.push({
      id: newCapabilityId('pad'),
      kind: 'tax',
      label: input.rules.taxLabel,
      amountMinor: taxMinor,
      allocation: allocateMinor(taxMinor, material.lines)
    })
  if (input.rules.feeMinor > 0)
    adjustments.push({
      id: newCapabilityId('pad'),
      kind: 'fee',
      label: input.rules.feeLabel,
      amountMinor: input.rules.feeMinor,
      allocation: allocateMinor(input.rules.feeMinor, material.lines)
    })
  if (material.tipMinor > 0)
    adjustments.push({
      id: newCapabilityId('pad'),
      kind: 'tip',
      label: 'Tip',
      amountMinor: material.tipMinor,
      allocation: allocateMinor(material.tipMinor, material.lines)
    })
  const adjustmentMinor = adjustments.reduce((sum, item) => sum + item.amountMinor, 0)
  return {
    id: input.id,
    bookingPartyId: material.bookingPartyId,
    version: input.version,
    currency: material.currency,
    subtotalMinor,
    adjustmentMinor,
    tipMinor: material.tipMinor,
    totalMinor: subtotalMinor + adjustmentMinor,
    facts: {
      partyVersion: material.partyVersion,
      pricingPolicyVersion: input.rules.version,
      lines: [...material.lines],
      policyVersions: [...material.policyVersions],
      promotionReservationIds: input.promotionReservationId
        ? [input.promotionReservationId]
        : [],
      giftCardReservationIds: [...material.giftCardReservationIds]
    },
    acceptedAt: null,
    expiresAt: material.expiresAt,
    adjustments
  }
}

const recovery = (quote: PricingQuote, partyVersion: number, now: string) =>
  quote.expiresAt <= now
    ? 'expired'
    : quote.facts.partyVersion !== partyVersion
      ? 'stale'
      : null

export const SeedPricingQuotes = (
  initial: readonly PricingQuote[] = [],
  promotions: readonly Promotion[] = [],
  rules: PricingRules = noPricingRules
): Layer.Layer<PricingQuotes> =>
  Layer.effect(
    PricingQuotes,
    Effect.gen(function* () {
      const semaphore = yield* Semaphore.make(1)
      const quotes = new Map(initial.map((quote) => [quote.id, structuredClone(quote)]))
      const acceptances = new Map(
        initial.flatMap((quote) =>
          quote.acceptedAt ? ([[quote.id, quote.acceptedAt]] as const) : []
        )
      )
      const reservations: PromotionReservation[] = []
      const exclusive = <A, E>(effect: Effect.Effect<A, E>) =>
        semaphore.withPermits(1)(effect)
      const find = (quoteId: string) =>
        [...quotes.values()].find((quote) => quote.id === quoteId)
      return {
        findLatest: (bookingPartyId) => {
          const quote = [...quotes.values()]
            .filter((item) => item.bookingPartyId === bookingPartyId)
            .sort((a, b) => b.version - a.version)[0]
          return quote
            ? Effect.succeed({
                ...structuredClone(quote),
                acceptedAt: acceptances.get(quote.id) ?? null
              })
            : Effect.fail(new PricingQuoteNotFound({ bookingPartyId }))
        },
        quote: (material) =>
          exclusive(
            Effect.gen(function* () {
              const invalid = validateMaterial(material)
              if (invalid) return yield* new InvalidQuoteMaterial({ reason: invalid })
              let promotion: Promotion | undefined
              if (material.promotionCode) {
                promotion = promotions.find(
                  (item) =>
                    item.code.toUpperCase() === material.promotionCode!.toUpperCase()
                )
                if (
                  !promotion ||
                  promotion.currency !== material.currency ||
                  promotion.startsAt > material.now ||
                  promotion.expiresAt <= material.now
                )
                  return yield* new PromotionUnavailable({
                    code: material.promotionCode,
                    reason: 'ineligible'
                  })
                const subtotal = material.lines.reduce(
                  (sum, line) => sum + line.amountMinor,
                  0
                )
                if (subtotal < promotion.minimumSubtotalMinor)
                  return yield* new PromotionUnavailable({
                    code: material.promotionCode,
                    reason: 'minimum_not_met'
                  })
                if (
                  promotion.maximumUses !== null &&
                  reservations.filter(
                    (item) =>
                      item.promotionId === promotion!.id &&
                      (item.status === 'active' || item.status === 'committed') &&
                      item.expiresAt > material.now
                  ).length >= promotion.maximumUses
                )
                  return yield* new PromotionUnavailable({
                    code: material.promotionCode,
                    reason: 'uses_exhausted'
                  })
              }
              const version =
                Math.max(
                  0,
                  ...[...quotes.values()]
                    .filter((item) => item.bookingPartyId === material.bookingPartyId)
                    .map((item) => item.version)
                ) + 1
              const id = newCapabilityId('pqt')
              const reservationId = promotion ? newCapabilityId('pmr') : undefined
              const quote = buildQuote({
                material,
                id,
                version,
                promotion,
                promotionReservationId: reservationId,
                rules
              })
              quotes.set(id, quote)
              if (promotion && reservationId)
                reservations.push({
                  id: reservationId,
                  promotionId: promotion.id,
                  quoteId: id,
                  expiresAt: material.expiresAt,
                  status: 'active'
                })
              return structuredClone(quote)
            })
          ),
        accept: (quoteId, partyVersion, now) =>
          exclusive(
            Effect.gen(function* () {
              const quote = find(quoteId)
              if (!quote)
                return yield* new PricingQuoteNotFound({
                  bookingPartyId: 'bpt_unknown'
                })
              const reason = recovery(quote, partyVersion, now)
              if (reason) return yield* new QuoteUnconfirmable({ quoteId, reason })
              const latest = [...quotes.values()]
                .filter((item) => item.bookingPartyId === quote.bookingPartyId)
                .sort((a, b) => b.version - a.version)[0]
              if (latest?.id !== quoteId)
                return yield* new QuoteUnconfirmable({ quoteId, reason: 'superseded' })
              const acceptedAt = acceptances.get(quoteId) ?? now
              acceptances.set(quoteId, acceptedAt)
              return { ...structuredClone(quote), acceptedAt }
            })
          ),
        requireAccepted: (quoteId, partyVersion, now) =>
          Effect.gen(function* () {
            const quote = find(quoteId)
            if (!quote)
              return yield* new PricingQuoteNotFound({ bookingPartyId: 'bpt_unknown' })
            const reason = recovery(quote, partyVersion, now)
            const acceptedAt = acceptances.get(quoteId)
            if (reason || !acceptedAt)
              return yield* new QuoteUnconfirmable({
                quoteId,
                reason: reason ?? 'stale'
              })
            const latest = [...quotes.values()]
              .filter((item) => item.bookingPartyId === quote.bookingPartyId)
              .sort((a, b) => b.version - a.version)[0]
            if (latest?.id !== quoteId)
              return yield* new QuoteUnconfirmable({ quoteId, reason: 'superseded' })
            return { ...structuredClone(quote), acceptedAt }
          }),
        commitPromotionReservations: (quoteId) =>
          exclusive(
            Effect.sync(() => {
              for (const reservation of reservations)
                if (reservation.quoteId === quoteId && reservation.status === 'active')
                  reservation.status = 'committed'
            })
          ),
        releasePromotionReservations: (quoteId) =>
          exclusive(
            Effect.sync(() => {
              for (const reservation of reservations)
                if (reservation.quoteId === quoteId && reservation.status === 'active')
                  reservation.status = 'released'
            })
          )
      }
    })
  )

export const LivePricingQuotes: Layer.Layer<PricingQuotes, never, Database> =
  Layer.effect(
    PricingQuotes,
    Effect.gen(function* () {
      const db = yield* Database
      const read = (quote: typeof pricingQuotes.$inferSelect) =>
        Effect.gen(function* () {
          const adjustments = yield* orUnavailable('pricing-quotes')(
            db
              .select()
              .from(pricingAdjustments)
              .where(eq(pricingAdjustments.pricingQuoteId, quote.id))
          )
          const [acceptance] = yield* orUnavailable('pricing-quotes')(
            db
              .select()
              .from(pricingQuoteAcceptances)
              .where(eq(pricingQuoteAcceptances.pricingQuoteId, quote.id))
              .limit(1)
          )
          return {
            id: quote.id,
            bookingPartyId: quote.bookingPartyId,
            version: quote.version,
            currency: quote.currency,
            subtotalMinor: quote.subtotalMinor,
            adjustmentMinor: quote.adjustmentMinor,
            tipMinor: quote.tipMinor,
            totalMinor: quote.totalMinor,
            facts: JSON.parse(quote.factsJson),
            acceptedAt: acceptance?.acceptedAt ?? null,
            expiresAt: quote.expiresAt,
            adjustments: adjustments.map((item) => ({
              id: item.id,
              kind: item.kind,
              label: item.label,
              amountMinor: item.amountMinor,
              allocation: JSON.parse(item.allocationJson)
            }))
          } as PricingQuote
        })
      const findLatest = (bookingPartyId: string) =>
        Effect.gen(function* () {
          const [quote] = yield* orUnavailable('pricing-quotes')(
            db
              .select()
              .from(pricingQuotes)
              .where(eq(pricingQuotes.bookingPartyId, bookingPartyId))
              .orderBy(desc(pricingQuotes.version))
              .limit(1)
          )
          if (!quote) return yield* new PricingQuoteNotFound({ bookingPartyId })
          return yield* read(quote)
        })
      return {
        findLatest,
        quote: (material) =>
          Effect.gen(function* () {
            const invalid = validateMaterial(material)
            if (invalid) return yield* new InvalidQuoteMaterial({ reason: invalid })
            const [party] = yield* orUnavailable('pricing-quotes')(
              db
                .select({
                  version: bookingParties.version,
                  currency: bookingParties.currency,
                  shopId: bookingParties.shopId,
                  merchantId: bookingSessions.merchantId
                })
                .from(bookingParties)
                .innerJoin(
                  bookingSessions,
                  eq(bookingSessions.id, bookingParties.bookingSessionId)
                )
                .where(eq(bookingParties.id, material.bookingPartyId))
                .limit(1)
            )
            if (!party || party.version !== material.partyVersion)
              return yield* new InvalidQuoteMaterial({
                reason: 'booking party changed'
              })
            if (party.currency !== material.currency)
              return yield* new InvalidQuoteMaterial({
                reason: 'currency does not match Booking Party'
              })
            const partyRequests = yield* orUnavailable('pricing-quotes')(
              db
                .select({ id: bookingRequests.id })
                .from(bookingRequests)
                .where(eq(bookingRequests.bookingPartyId, material.bookingPartyId))
            )
            const suppliedRequestIds = new Set(
              material.lines.map((line) => line.requestId)
            )
            if (
              partyRequests.length !== suppliedRequestIds.size ||
              partyRequests.some((request) => !suppliedRequestIds.has(request.id))
            )
              return yield* new InvalidQuoteMaterial({
                reason: 'quote must include every Booking Request exactly once'
              })
            yield* Effect.forEach(
              material.lines,
              (line) =>
                Effect.gen(function* () {
                  const selected = yield* orUnavailable('pricing-quotes')(
                    db
                      .select({
                        serviceId: services.id,
                        priceMinor: services.priceMinor
                      })
                      .from(bookingRequests)
                      .innerJoin(
                        bookingRequestServices,
                        eq(bookingRequestServices.bookingRequestId, bookingRequests.id)
                      )
                      .innerJoin(
                        services,
                        eq(services.id, bookingRequestServices.serviceId)
                      )
                      .where(
                        and(
                          eq(bookingRequests.id, line.requestId),
                          eq(bookingRequests.bookingPartyId, material.bookingPartyId)
                        )
                      )
                  )
                  const [hold] = yield* orUnavailable('pricing-quotes')(
                    db
                      .select({ id: timeSlotHolds.id })
                      .from(timeSlotHolds)
                      .where(
                        and(
                          eq(timeSlotHolds.id, line.holdId),
                          eq(timeSlotHolds.bookingRequestId, line.requestId),
                          sql`${timeSlotHolds.expiresAt} > ${material.now}`
                        )
                      )
                      .limit(1)
                  )
                  const selectedIds = selected.map((item) => item.serviceId).sort()
                  const suppliedIds = [...line.serviceIds].sort()
                  const serverAmount = selected.reduce(
                    (sum, item) => sum + item.priceMinor,
                    0
                  )
                  if (
                    !hold ||
                    selectedIds.length !== suppliedIds.length ||
                    selectedIds.some((id, index) => id !== suppliedIds[index]) ||
                    serverAmount !== line.amountMinor
                  )
                    return yield* new InvalidQuoteMaterial({
                      reason:
                        'request, hold, services, or amount no longer match server state'
                    })
                }),
              { discard: true }
            )
            const policyRows = yield* orUnavailable('pricing-quotes')(
              db
                .select()
                .from(checkoutPolicies)
                .where(
                  and(
                    eq(checkoutPolicies.shopId, party.shopId),
                    sql`${checkoutPolicies.effectiveAt} <= ${material.now}`,
                    sql`(${checkoutPolicies.retiredAt} IS NULL OR ${checkoutPolicies.retiredAt} > ${material.now})`
                  )
                )
            )
            const activePolicyVersions = policyRows
              .map((policy) => `${policy.kind}:${policy.version}`)
              .sort()
            if (
              activePolicyVersions.length !== material.policyVersions.length ||
              activePolicyVersions.some(
                (version, index) =>
                  version !== [...material.policyVersions].sort()[index]
              )
            )
              return yield* new InvalidQuoteMaterial({
                reason: 'policy versions no longer match server state'
              })
            const reservations = yield* orUnavailable('pricing-quotes')(
              db
                .select({ id: giftCardReservations.id })
                .from(giftCardReservations)
                .where(
                  and(
                    eq(giftCardReservations.bookingPartyId, material.bookingPartyId),
                    eq(giftCardReservations.currency, material.currency),
                    eq(giftCardReservations.status, 'active'),
                    sql`${giftCardReservations.expiresAt} > ${material.now}`
                  )
                )
            )
            const activeIds = new Set(reservations.map((item) => item.id))
            if (
              activeIds.size !== material.giftCardReservationIds.length ||
              material.giftCardReservationIds.some((id) => !activeIds.has(id))
            )
              return yield* new InvalidQuoteMaterial({
                reason: 'gift-card reservations no longer match server state'
              })
            const [policy] = yield* orUnavailable('pricing-quotes')(
              db
                .select()
                .from(pricingPolicies)
                .where(eq(pricingPolicies.shopId, party.shopId))
                .limit(1)
            )
            const pricingRules: PricingRules = policy
              ? {
                  taxBasisPoints: policy.taxBasisPoints,
                  taxLabel: policy.taxLabel,
                  feeMinor: policy.feeMinor,
                  feeLabel: policy.feeLabel,
                  version: policy.version
                }
              : noPricingRules
            let promotion: Promotion | undefined
            if (material.promotionCode) {
              const [row] = yield* orUnavailable('pricing-quotes')(
                db
                  .select()
                  .from(promotions)
                  .where(
                    and(
                      eq(promotions.merchantId, party.merchantId),
                      eq(promotions.code, material.promotionCode.toUpperCase())
                    )
                  )
                  .limit(1)
              )
              if (
                !row ||
                row.currency !== material.currency ||
                row.startsAt > material.now ||
                row.expiresAt <= material.now
              )
                return yield* new PromotionUnavailable({
                  code: material.promotionCode,
                  reason: 'ineligible'
                })
              const subtotal = material.lines.reduce(
                (sum, line) => sum + line.amountMinor,
                0
              )
              if (subtotal < row.minimumSubtotalMinor)
                return yield* new PromotionUnavailable({
                  code: material.promotionCode,
                  reason: 'minimum_not_met'
                })
              const [usage] = yield* orUnavailable('pricing-quotes')(
                db
                  .select({ uses: sql<number>`count(*)` })
                  .from(promotionReservations)
                  .where(
                    and(
                      eq(promotionReservations.promotionId, row.id),
                      eq(promotionReservations.status, 'active'),
                      sql`${promotionReservations.expiresAt} > ${material.now}`
                    )
                  )
              )
              if (
                row.maximumUses !== null &&
                Number(usage?.uses ?? 0) >= row.maximumUses
              )
                return yield* new PromotionUnavailable({
                  code: material.promotionCode,
                  reason: 'uses_exhausted'
                })
              promotion = row
            }
            const latest = yield* Effect.option(findLatest(material.bookingPartyId))
            const version = latest._tag === 'Some' ? latest.value.version + 1 : 1
            const id = newCapabilityId('pqt')
            const reservationId = promotion ? newCapabilityId('pmr') : undefined
            const quote = buildQuote({
              material,
              id,
              version,
              promotion,
              promotionReservationId: reservationId,
              rules: pricingRules
            })
            const statements: BatchStatement[] = [
              db
                .update(promotionReservations)
                .set({ status: 'expired' })
                .where(
                  and(
                    eq(promotionReservations.status, 'active'),
                    sql`${promotionReservations.expiresAt} <= ${material.now}`
                  )
                ),
              db.insert(pricingQuotes).values({
                id,
                bookingPartyId: material.bookingPartyId,
                version,
                currency: quote.currency,
                subtotalMinor: quote.subtotalMinor,
                adjustmentMinor: quote.adjustmentMinor,
                tipMinor: quote.tipMinor,
                totalMinor: quote.totalMinor,
                factsJson: JSON.stringify(quote.facts),
                acceptedAt: null,
                expiresAt: quote.expiresAt,
                createdAt: material.now
              }),
              ...quote.adjustments.map((item) =>
                db.insert(pricingAdjustments).values({
                  id: item.id,
                  pricingQuoteId: id,
                  kind: item.kind,
                  label: item.label,
                  amountMinor: item.amountMinor,
                  allocationJson: JSON.stringify(item.allocation),
                  createdAt: material.now
                })
              )
            ]
            if (promotion && reservationId)
              statements.push(
                db.insert(promotionReservations).values({
                  id: reservationId,
                  promotionId: promotion.id,
                  pricingQuoteId: id,
                  status: 'active',
                  expiresAt: material.expiresAt,
                  createdAt: material.now
                })
              )
            yield* batch(db, statements).pipe(
              Effect.mapError((error) =>
                /promotion uses exhausted/i.test(error.reason)
                  ? new PromotionUnavailable({
                      code: material.promotionCode ?? '',
                      reason: 'uses_exhausted'
                    })
                  : /pricing_quotes_party_version_unique|promotion_reservations_quote_unique/i.test(
                        error.reason
                      )
                    ? new InvalidQuoteMaterial({
                        reason: 'quote version or reservation conflict'
                      })
                    : new CapabilityUnavailable({
                        capability: 'pricing-quotes',
                        reason: error.reason
                      })
              )
            )
            return quote
          }),
        accept: (quoteId, partyVersion, now) =>
          Effect.gen(function* () {
            const [row] = yield* orUnavailable('pricing-quotes')(
              db
                .select()
                .from(pricingQuotes)
                .where(eq(pricingQuotes.id, quoteId))
                .limit(1)
            )
            if (!row)
              return yield* new PricingQuoteNotFound({ bookingPartyId: 'bpt_unknown' })
            const quote = yield* read(row)
            const reason = recovery(quote, partyVersion, now)
            if (reason) return yield* new QuoteUnconfirmable({ quoteId, reason })
            const latest = yield* findLatest(quote.bookingPartyId)
            if (latest.id !== quoteId)
              return yield* new QuoteUnconfirmable({ quoteId, reason: 'superseded' })
            if (!quote.acceptedAt)
              yield* orUnavailable('pricing-quotes')(
                db.insert(pricingQuoteAcceptances).values({
                  pricingQuoteId: quoteId,
                  bookingPartyId: quote.bookingPartyId,
                  partyVersion,
                  acceptedAt: now,
                  createdAt: now
                })
              )
            return { ...quote, acceptedAt: quote.acceptedAt ?? now }
          }),
        requireAccepted: (quoteId, partyVersion, now) =>
          Effect.gen(function* () {
            const [row] = yield* orUnavailable('pricing-quotes')(
              db
                .select()
                .from(pricingQuotes)
                .where(eq(pricingQuotes.id, quoteId))
                .limit(1)
            )
            if (!row)
              return yield* new PricingQuoteNotFound({ bookingPartyId: 'bpt_unknown' })
            const quote = yield* read(row)
            const reason = recovery(quote, partyVersion, now)
            if (reason || !quote.acceptedAt)
              return yield* new QuoteUnconfirmable({
                quoteId,
                reason: reason ?? 'stale'
              })
            const latest = yield* findLatest(quote.bookingPartyId)
            if (latest.id !== quoteId)
              return yield* new QuoteUnconfirmable({ quoteId, reason: 'superseded' })
            const [party] = yield* orUnavailable('pricing-quotes')(
              db
                .select({ shopId: bookingParties.shopId })
                .from(bookingParties)
                .where(eq(bookingParties.id, quote.bookingPartyId))
                .limit(1)
            )
            const activeHolds = yield* orUnavailable('pricing-quotes')(
              db
                .select({ id: timeSlotHolds.id })
                .from(timeSlotHolds)
                .where(sql`${timeSlotHolds.expiresAt} > ${now}`)
            )
            const activeHoldIds = new Set(activeHolds.map((item) => item.id))
            if (quote.facts.lines.some((line) => !activeHoldIds.has(line.holdId)))
              return yield* new QuoteUnconfirmable({ quoteId, reason: 'stale' })
            if (quote.facts.giftCardReservationIds.length > 0) {
              const activeGiftCards = yield* orUnavailable('pricing-quotes')(
                db
                  .select({ id: giftCardReservations.id })
                  .from(giftCardReservations)
                  .where(
                    and(
                      eq(giftCardReservations.bookingPartyId, quote.bookingPartyId),
                      eq(giftCardReservations.status, 'active'),
                      sql`${giftCardReservations.expiresAt} > ${now}`
                    )
                  )
              )
              const activeGiftCardIds = new Set(activeGiftCards.map((item) => item.id))
              if (
                quote.facts.giftCardReservationIds.some(
                  (id) => !activeGiftCardIds.has(id)
                )
              )
                return yield* new QuoteUnconfirmable({ quoteId, reason: 'stale' })
            }
            if (party) {
              const [pricingPolicy] = yield* orUnavailable('pricing-quotes')(
                db
                  .select({ version: pricingPolicies.version })
                  .from(pricingPolicies)
                  .where(eq(pricingPolicies.shopId, party.shopId))
                  .limit(1)
              )
              if ((pricingPolicy?.version ?? 0) !== quote.facts.pricingPolicyVersion)
                return yield* new QuoteUnconfirmable({ quoteId, reason: 'stale' })
              const policies = yield* orUnavailable('pricing-quotes')(
                db
                  .select({
                    kind: checkoutPolicies.kind,
                    version: checkoutPolicies.version
                  })
                  .from(checkoutPolicies)
                  .where(
                    and(
                      eq(checkoutPolicies.shopId, party.shopId),
                      sql`${checkoutPolicies.effectiveAt} <= ${now}`,
                      sql`(${checkoutPolicies.retiredAt} IS NULL OR ${checkoutPolicies.retiredAt} > ${now})`
                    )
                  )
              )
              const versions = policies
                .map((item) => `${item.kind}:${item.version}`)
                .sort()
              if (
                versions.length !== quote.facts.policyVersions.length ||
                versions.some(
                  (version, index) =>
                    version !== [...quote.facts.policyVersions].sort()[index]
                )
              )
                return yield* new QuoteUnconfirmable({ quoteId, reason: 'stale' })
            }
            return quote
          }),
        commitPromotionReservations: (quoteId) =>
          orUnavailable('pricing-quotes')(
            db
              .update(promotionReservations)
              .set({ status: 'committed' })
              .where(
                and(
                  eq(promotionReservations.pricingQuoteId, quoteId),
                  eq(promotionReservations.status, 'active')
                )
              )
          ).pipe(Effect.asVoid),
        releasePromotionReservations: (quoteId) =>
          orUnavailable('pricing-quotes')(
            db
              .update(promotionReservations)
              .set({ status: 'released' })
              .where(
                and(
                  eq(promotionReservations.pricingQuoteId, quoteId),
                  eq(promotionReservations.status, 'active')
                )
              )
          ).pipe(Effect.asVoid)
      }
    })
  )
