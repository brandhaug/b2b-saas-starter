import { Context, Effect, Layer, Schema } from 'effect'
import type { D1Database } from '@cloudflare/workers-types'
import { Database } from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import { NotificationIntentId, ShopId } from '../ids.ts'
import {
  hasOperatorPermission,
  type OperatorPrincipal
} from '../operations/operations-contracts.ts'
import { ProviderAttemptId, ProviderFingerprint } from './provider-contracts.ts'

const positiveMilliEuro = Schema.Int.check(Schema.isGreaterThan(0))
const nonNegativeMilliEuro = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const MessagingRateCard = Schema.Struct({
  id: Schema.String,
  version: Schema.Int,
  currency: Schema.Literal('EUR'),
  chargeMilliEuro: positiveMilliEuro,
  effectiveAt: Schema.String,
  noticePublishedAt: Schema.optional(Schema.String),
  retiredAt: Schema.optional(Schema.String)
})

export const MessagingBalance = Schema.Struct({
  shopId: ShopId,
  currency: Schema.Literal('EUR'),
  postedMilliEuro: Schema.Int,
  reservedMilliEuro: nonNegativeMilliEuro,
  availableMilliEuro: nonNegativeMilliEuro,
  financiallyFrozen: Schema.Boolean,
  lowBalanceNoticeArmed: Schema.Boolean
})

export const MessagingLedgerEntry = Schema.Struct({
  id: Schema.String,
  shopId: ShopId,
  direction: Schema.Literals(['credit', 'debit']),
  kind: Schema.Literals([
    'top_up',
    'delivery_charge',
    'operator_adjustment',
    'refund',
    'correction',
    'promotional_credit'
  ]),
  amountMilliEuro: positiveMilliEuro,
  currency: Schema.Literal('EUR'),
  sourceType: Schema.String,
  sourceId: Schema.String,
  idempotencyKey: Schema.String,
  rateCardId: Schema.optional(Schema.String),
  intentId: Schema.optional(NotificationIntentId),
  actorType: Schema.optional(Schema.String),
  actorId: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
  fiscalReference: Schema.optional(Schema.String),
  externalFactId: Schema.optional(Schema.String),
  reversesEntryId: Schema.optional(Schema.String),
  correctionReason: Schema.optional(Schema.String),
  occurredAt: Schema.String
})

export const MessagingBalanceReservation = Schema.Struct({
  id: Schema.String,
  shopId: ShopId,
  intentId: NotificationIntentId,
  rateCardId: Schema.String,
  amountMilliEuro: positiveMilliEuro,
  status: Schema.Literals(['active', 'converted', 'released']),
  expiresAt: Schema.String,
  convertedAt: Schema.optional(Schema.String),
  releasedAt: Schema.optional(Schema.String),
  releaseReason: Schema.optional(Schema.String)
})

export const ChargeableDelivery = Schema.Struct({
  id: Schema.String,
  shopId: ShopId,
  intentId: NotificationIntentId,
  reservationId: Schema.String,
  rateCardId: Schema.String,
  routeId: Schema.String,
  chargeMilliEuro: positiveMilliEuro,
  verifiedAt: Schema.String,
  ledgerEntryId: Schema.String
})

export const ProviderMessagingCost = Schema.Struct({
  id: Schema.String,
  shopId: ShopId,
  intentId: NotificationIntentId,
  attemptId: ProviderAttemptId,
  environment: Schema.String,
  provider: Schema.Literals(['meta', 'smso']),
  unitOrdinal: Schema.Int,
  amountMinorUnits: nonNegativeMilliEuro,
  currency: Schema.String,
  currencyScale: Schema.Int,
  units: positiveMilliEuro,
  source: Schema.Literals(['response', 'callback', 'query', 'invoice']),
  recordedAt: Schema.String
})

export const MessagingFinancialExternalFact = Schema.Struct({
  id: Schema.String,
  shopId: ShopId,
  kind: Schema.Literals([
    'provider_payment',
    'provider_refund',
    'invoice',
    'credit_note',
    'efactura'
  ]),
  provider: Schema.String,
  sourceId: Schema.String,
  status: Schema.Literals([
    'pending',
    'confirmed',
    'failed',
    'issued',
    'submitted',
    'accepted',
    'rejected',
    'cancelled'
  ]),
  amountMilliEuro: Schema.optional(nonNegativeMilliEuro),
  currency: Schema.String,
  reference: Schema.optional(Schema.String),
  relatedSourceId: Schema.optional(Schema.String),
  observedAt: Schema.String
})

export const MessagingFinancialReconciliationInputs = Schema.Struct({
  shopId: ShopId,
  balance: MessagingBalance,
  ledgerEntries: Schema.Array(MessagingLedgerEntry),
  reservations: Schema.Array(MessagingBalanceReservation),
  chargeableDeliveries: Schema.Array(ChargeableDelivery),
  providerCosts: Schema.Array(ProviderMessagingCost),
  externalFacts: Schema.Array(MessagingFinancialExternalFact),
  openCaseIds: Schema.Array(Schema.String),
  invoiceReferences: Schema.Array(Schema.String),
  paymentSourceIdentities: Schema.Array(
    Schema.Struct({
      entryId: Schema.String,
      kind: Schema.Literals(['top_up', 'refund']),
      sourceType: Schema.String,
      sourceId: Schema.String,
      idempotencyKey: Schema.String,
      externalFactId: Schema.optional(Schema.String),
      fiscalReference: Schema.optional(Schema.String)
    })
  ),
  ledgerEntryCount: Schema.Int,
  activeReservationCount: Schema.Int,
  chargeableDeliveryCount: Schema.Int,
  providerCostCount: Schema.Int,
  openCaseCount: Schema.Int
})

export const MerchantMessagingTransaction = Schema.Struct({
  id: Schema.String,
  direction: Schema.Literals(['credit', 'debit']),
  kind: MessagingLedgerEntry.fields.kind,
  amountMilliEuro: positiveMilliEuro,
  currency: Schema.Literal('EUR'),
  occurredAt: Schema.String,
  fiscalReference: Schema.optional(Schema.String),
  intentId: Schema.optional(NotificationIntentId),
  reversesEntryId: Schema.optional(Schema.String)
})

export const MerchantMessagingFinanceProjection = Schema.Struct({
  balance: MessagingBalance,
  transactions: Schema.Array(MerchantMessagingTransaction)
})

export const MessagingMarginProjection = Schema.Struct({
  trailingSince: Schema.String,
  netMerchantChargeMilliEuro: nonNegativeMilliEuro,
  comparableProviderCostNanoEuro: Schema.String,
  nonEurProviderCostsPresent: Schema.Boolean,
  expectedRouteThresholdBreached: Schema.Boolean,
  status: Schema.Literals(['healthy', 'warning', 'critical', 'not_comparable'])
})

export const ExpectedProviderRouteCost = Schema.Struct({
  provider: Schema.Literals(['meta', 'smso']),
  channel: Schema.Literals(['whatsapp', 'sms']),
  amountMinorUnits: nonNegativeMilliEuro,
  currency: Schema.String,
  currencyScale: Schema.Int,
  units: positiveMilliEuro
})

export const OperationsProviderMessagingCost = Schema.Struct({
  id: Schema.String,
  shopId: ShopId,
  intentId: NotificationIntentId,
  attemptId: ProviderAttemptId,
  provider: Schema.Literals(['meta', 'smso']),
  amountMinorUnits: nonNegativeMilliEuro,
  currency: Schema.String,
  currencyScale: Schema.Int,
  units: positiveMilliEuro,
  source: Schema.Literals(['response', 'callback', 'query', 'invoice']),
  recordedAt: Schema.String
})

export const OperationsMessagingFinancialReconciliation = Schema.Struct({
  shopId: ShopId,
  balance: MessagingBalance,
  ledgerEntries: Schema.Array(MessagingLedgerEntry),
  reservations: Schema.Array(MessagingBalanceReservation),
  chargeableDeliveries: Schema.Array(ChargeableDelivery),
  providerCosts: Schema.Array(OperationsProviderMessagingCost),
  externalFacts: Schema.Array(MessagingFinancialExternalFact),
  openCaseIds: Schema.Array(Schema.String),
  invoiceReferences: Schema.Array(Schema.String),
  paymentSourceIdentities:
    MessagingFinancialReconciliationInputs.fields.paymentSourceIdentities,
  ledgerEntryCount: Schema.Int,
  activeReservationCount: Schema.Int,
  chargeableDeliveryCount: Schema.Int,
  providerCostCount: Schema.Int,
  openCaseCount: Schema.Int
})

export const OperationsMessagingFinanceProjection = Schema.Struct({
  rateCards: Schema.Array(MessagingRateCard),
  reconciliation: OperationsMessagingFinancialReconciliation,
  margin: MessagingMarginProjection
})

export class MessagingFinanceRejected extends Schema.TaggedErrorClass<MessagingFinanceRejected>()(
  'MessagingFinanceRejected',
  {
    operation: Schema.String,
    reason: Schema.Literals([
      'invalid_amount',
      'intent_unavailable',
      'route_unavailable',
      'rate_card_unavailable',
      'balance_unavailable',
      'financially_frozen',
      'insufficient_balance',
      'reservation_unavailable',
      'reservation_not_active',
      'entry_unavailable',
      'idempotency_conflict',
      'invalid_correction',
      'missing_provenance',
      'funding_unconfirmed'
    ]),
    shopId: Schema.optional(ShopId),
    resourceId: Schema.optional(Schema.String)
  }
) {}

type RateCard = typeof MessagingRateCard.Type
type Balance = typeof MessagingBalance.Type
type LedgerEntry = typeof MessagingLedgerEntry.Type
type Reservation = typeof MessagingBalanceReservation.Type
type Delivery = typeof ChargeableDelivery.Type
type ProviderCost = typeof ProviderMessagingCost.Type
type ExternalFact = typeof MessagingFinancialExternalFact.Type
type ReconciliationInputs = typeof MessagingFinancialReconciliationInputs.Type
type MerchantProjection = typeof MerchantMessagingFinanceProjection.Type
type OperationsProjection = typeof OperationsMessagingFinanceProjection.Type
type FinanceError = MessagingFinanceRejected | CapabilityUnavailable

type LedgerProvenance = {
  readonly sourceType: string
  readonly sourceId: string
  readonly idempotencyKey: string
  readonly actorType?: string
  readonly actorId?: string
  readonly operatorPrincipal?: OperatorPrincipal
  readonly reason?: string
  readonly fiscalReference?: string
  readonly externalFactId?: string
  readonly occurredAt: string
}

const hasText = (value: string | undefined): value is string => Boolean(value?.trim())

const validateLedgerPolicy = (
  input: LedgerProvenance & {
    readonly kind: 'top_up' | 'operator_adjustment' | 'promotional_credit' | 'refund'
    readonly amountMilliEuro: number
  }
): 'invalid_amount' | 'missing_provenance' | undefined => {
  if (input.kind === 'top_up') {
    if (![10_000, 25_000, 50_000].includes(input.amountMilliEuro))
      return 'invalid_amount'
    if (!hasText(input.fiscalReference)) return 'missing_provenance'
    if (!hasText(input.externalFactId)) return 'missing_provenance'
    return undefined
  }
  if (
    !input.operatorPrincipal ||
    !hasOperatorPermission(input.operatorPrincipal.roles, 'messaging:finance') ||
    input.actorType !== 'system_operator' ||
    !hasText(input.actorId) ||
    input.actorId !== input.operatorPrincipal.id ||
    !hasText(input.reason) ||
    (input.kind === 'refund' && !hasText(input.fiscalReference))
  )
    return 'missing_provenance'
  return undefined
}

const validateCorrectionProvenance = (
  input: LedgerProvenance
): 'missing_provenance' | undefined =>
  (input.actorType !== 'system' && input.actorType !== 'system_operator') ||
  !hasText(input.actorId) ||
  !hasText(input.reason) ||
  (input.actorType === 'system_operator' &&
    (!input.operatorPrincipal ||
      input.actorId !== input.operatorPrincipal.id ||
      !hasOperatorPermission(input.operatorPrincipal.roles, 'messaging:finance')))
    ? 'missing_provenance'
    : undefined

export type MessagingFinanceShape = {
  readonly effectiveRateCard: (at: string) => Effect.Effect<RateCard, FinanceError>
  readonly balance: (shopId: string) => Effect.Effect<Balance, FinanceError>
  readonly statement: (
    shopId: string
  ) => Effect.Effect<readonly LedgerEntry[], FinanceError>
  readonly merchantProjection: (
    shopId: string
  ) => Effect.Effect<MerchantProjection, FinanceError>
  readonly credit: (
    input: LedgerProvenance & {
      readonly shopId: string
      readonly kind: 'top_up' | 'operator_adjustment' | 'promotional_credit'
      readonly amountMilliEuro: number
    }
  ) => Effect.Effect<LedgerEntry, FinanceError>
  readonly debit: (
    input: LedgerProvenance & {
      readonly shopId: string
      readonly kind: 'operator_adjustment' | 'refund'
      readonly amountMilliEuro: number
    }
  ) => Effect.Effect<LedgerEntry, FinanceError>
  readonly reserve: (input: {
    readonly shopId: string
    readonly intentId: string
    readonly expiresAt: string
    readonly reservedAt: string
  }) => Effect.Effect<Reservation, FinanceError>
  readonly release: (input: {
    readonly shopId: string
    readonly intentId: string
    readonly reason: string
    readonly releasedAt: string
  }) => Effect.Effect<Reservation, FinanceError>
  readonly convertDelivery: (input: {
    readonly shopId: string
    readonly intentId: string
    readonly routeId: string
    readonly verifiedAt: string
  }) => Effect.Effect<Delivery, FinanceError>
  readonly correct: (
    input: LedgerProvenance & {
      readonly shopId: string
      readonly entryId: string
      readonly correctionReason: string
    }
  ) => Effect.Effect<LedgerEntry, FinanceError>
  readonly recordProviderCost: (input: {
    readonly shopId: string
    readonly intentId: string
    readonly attemptId: typeof ProviderAttemptId.Type
    readonly environment: string
    readonly provider: 'meta' | 'smso'
    readonly providerAccountKey: string
    readonly billingIdentityFingerprint: typeof ProviderFingerprint.Type
    readonly unitOrdinal: number
    readonly amountMinorUnits: number
    readonly currency: string
    readonly currencyScale: number
    readonly units: number
    readonly source: 'response' | 'callback' | 'query' | 'invoice'
    readonly recordedAt: string
  }) => Effect.Effect<ProviderCost, FinanceError>
  readonly recordExternalFact: (
    input: Omit<ExternalFact, 'id'>
  ) => Effect.Effect<ExternalFact, FinanceError>
  readonly reconciliationInputs: (
    shopId: string
  ) => Effect.Effect<ReconciliationInputs, FinanceError>
  readonly operationsProjection: (input: {
    readonly shopId: string
    readonly asOf: string
    readonly expectedRouteCosts: readonly (typeof ExpectedProviderRouteCost.Type)[]
  }) => Effect.Effect<OperationsProjection, FinanceError>
}

export class MessagingFinance extends Context.Service<
  MessagingFinance,
  MessagingFinanceShape
>()('@b2b-saas-starter/capabilities/notifications/MessagingFinance') {}

type RawRow = Record<string, unknown>
type RawD1 = D1Database

const id = (prefix: string): string => `${prefix}_${crypto.randomUUID()}`
const optional = <K extends string, V>(key: K, value: V | null) =>
  value === null ? {} : ({ [key]: value } as { readonly [P in K]: V })

const unavailable = (reason: unknown) =>
  new CapabilityUnavailable({
    capability: 'messaging-finance',
    reason: reason instanceof Error ? reason.message : String(reason)
  })

const tryDb = <A>(run: () => Promise<A>): Effect.Effect<A, CapabilityUnavailable> =>
  Effect.tryPromise({ try: run, catch: unavailable })

const first = <A extends RawRow>(raw: RawD1, sql: string, ...params: unknown[]) =>
  tryDb(() =>
    raw
      .prepare(sql)
      .bind(...params)
      .first<A>()
  )

const all = <A extends RawRow>(raw: RawD1, sql: string, ...params: unknown[]) =>
  Effect.map(
    tryDb(() =>
      raw
        .prepare(sql)
        .bind(...params)
        .all<A>()
    ),
    (result) => result.results
  )

const batch = (
  raw: RawD1,
  statements: readonly { sql: string; params: readonly unknown[] }[]
) =>
  tryDb(() =>
    raw.batch(
      statements.map((statement) =>
        raw.prepare(statement.sql).bind(...statement.params)
      )
    )
  )

type RateCardRow = {
  id: string
  version: number
  currency: 'EUR'
  charge_milli_euro: number
  effective_at: string
  notice_published_at: string | null
  retired_at: string | null
}

const rateCardFromRow = (row: RateCardRow): RateCard => ({
  id: row.id,
  version: row.version,
  currency: row.currency,
  chargeMilliEuro: row.charge_milli_euro,
  effectiveAt: row.effective_at,
  ...optional('noticePublishedAt', row.notice_published_at),
  ...optional('retiredAt', row.retired_at)
})

type BalanceRow = {
  shop_id: string
  currency: 'EUR'
  posted_milli_euro: number
  reserved_milli_euro: number
  available_milli_euro: number
  financially_frozen: number
  low_balance_notice_armed: number
}

const balanceFromRow = (row: BalanceRow): Balance => ({
  shopId: row.shop_id,
  currency: row.currency,
  postedMilliEuro: row.posted_milli_euro,
  reservedMilliEuro: row.reserved_milli_euro,
  availableMilliEuro: row.available_milli_euro,
  financiallyFrozen: row.financially_frozen === 1,
  lowBalanceNoticeArmed: row.low_balance_notice_armed === 1
})

type LedgerRow = {
  id: string
  shop_id: string
  direction: 'credit' | 'debit'
  kind: LedgerEntry['kind']
  amount_milli_euro: number
  currency: 'EUR'
  source_type: string
  source_id: string
  idempotency_key: string
  rate_card_id: string | null
  intent_id: string | null
  actor_type: string | null
  actor_id: string | null
  reason: string | null
  fiscal_reference: string | null
  external_fact_id: string | null
  reverses_entry_id: string | null
  correction_reason: string | null
  occurred_at: string
}

const ledgerFromRow = (row: LedgerRow): LedgerEntry => ({
  id: row.id,
  shopId: row.shop_id,
  direction: row.direction,
  kind: row.kind,
  amountMilliEuro: row.amount_milli_euro,
  currency: row.currency,
  sourceType: row.source_type,
  sourceId: row.source_id,
  idempotencyKey: row.idempotency_key,
  ...optional('rateCardId', row.rate_card_id),
  ...optional('intentId', row.intent_id),
  ...optional('actorType', row.actor_type),
  ...optional('actorId', row.actor_id),
  ...optional('reason', row.reason),
  ...optional('fiscalReference', row.fiscal_reference),
  ...optional('externalFactId', row.external_fact_id),
  ...optional('reversesEntryId', row.reverses_entry_id),
  ...optional('correctionReason', row.correction_reason),
  occurredAt: row.occurred_at
})

type ReservationRow = {
  id: string
  shop_id: string
  intent_id: string
  rate_card_id: string
  amount_milli_euro: number
  status: Reservation['status']
  expires_at: string
  converted_at: string | null
  released_at: string | null
  release_reason: string | null
}

const reservationFromRow = (row: ReservationRow): Reservation => ({
  id: row.id,
  shopId: row.shop_id,
  intentId: row.intent_id,
  rateCardId: row.rate_card_id,
  amountMilliEuro: row.amount_milli_euro,
  status: row.status,
  expiresAt: row.expires_at,
  ...optional('convertedAt', row.converted_at),
  ...optional('releasedAt', row.released_at),
  ...optional('releaseReason', row.release_reason)
})

type DeliveryRow = {
  id: string
  shop_id: string
  intent_id: string
  reservation_id: string
  rate_card_id: string
  route_id: string
  charge_milli_euro: number
  verified_at: string
  ledger_entry_id: string
}

type ProviderCostRow = {
  id: string
  shop_id: string
  intent_id: string
  attempt_id: string
  environment: string
  provider: 'meta' | 'smso'
  provider_account_key: string
  billing_identity_fingerprint: string
  unit_ordinal: number
  amount_minor_units: number
  currency: string
  currency_scale: number
  units: number
  source: ProviderCost['source']
  recorded_at: string
}

type ExternalFactRow = {
  id: string
  shop_id: string
  kind: ExternalFact['kind']
  provider: string
  source_id: string
  status: ExternalFact['status']
  amount_milli_euro: number | null
  currency: string
  reference: string | null
  related_source_id: string | null
  observed_at: string
}

const externalFactFromRow = (row: ExternalFactRow): ExternalFact => ({
  id: row.id,
  shopId: row.shop_id,
  kind: row.kind,
  provider: row.provider,
  sourceId: row.source_id,
  status: row.status,
  ...optional('amountMilliEuro', row.amount_milli_euro),
  currency: row.currency,
  ...optional('reference', row.reference),
  ...optional('relatedSourceId', row.related_source_id),
  observedAt: row.observed_at
})

const providerCostFromRow = (row: ProviderCostRow): ProviderCost => ({
  id: row.id,
  shopId: row.shop_id,
  intentId: row.intent_id,
  attemptId: row.attempt_id,
  environment: row.environment,
  provider: row.provider,
  unitOrdinal: row.unit_ordinal,
  amountMinorUnits: row.amount_minor_units,
  currency: row.currency,
  currencyScale: row.currency_scale,
  units: row.units,
  source: row.source,
  recordedAt: row.recorded_at
})

const merchantTransaction = (
  entry: LedgerEntry
): typeof MerchantMessagingTransaction.Type => ({
  id: entry.id,
  direction: entry.direction,
  kind: entry.kind,
  amountMilliEuro: entry.amountMilliEuro,
  currency: entry.currency,
  occurredAt: entry.occurredAt,
  ...(entry.fiscalReference ? { fiscalReference: entry.fiscalReference } : {}),
  ...(entry.intentId ? { intentId: entry.intentId } : {}),
  ...(entry.reversesEntryId ? { reversesEntryId: entry.reversesEntryId } : {})
})

const reconciliationMetadata = (entries: readonly LedgerEntry[]) => ({
  invoiceReferences: [
    ...new Set(
      entries.flatMap((entry) => (entry.fiscalReference ? [entry.fiscalReference] : []))
    )
  ],
  paymentSourceIdentities: entries.flatMap((entry) =>
    entry.kind === 'top_up' || entry.kind === 'refund'
      ? [
          {
            entryId: entry.id,
            kind: entry.kind,
            sourceType: entry.sourceType,
            sourceId: entry.sourceId,
            idempotencyKey: entry.idempotencyKey,
            ...(entry.externalFactId ? { externalFactId: entry.externalFactId } : {}),
            ...(entry.fiscalReference ? { fiscalReference: entry.fiscalReference } : {})
          }
        ]
      : []
  )
})

const deriveMarginProjection = (
  input: ReconciliationInputs,
  trailingSince: string,
  expectedRouteCosts: readonly (typeof ExpectedProviderRouteCost.Type)[]
): typeof MessagingMarginProjection.Type => {
  const entriesById = new Map(input.ledgerEntries.map((entry) => [entry.id, entry]))
  const netMerchantChargeMilliEuro = Math.max(
    0,
    input.ledgerEntries
      .filter((entry) => entry.occurredAt >= trailingSince)
      .reduce((total, entry) => {
        if (entry.kind === 'delivery_charge' && entry.direction === 'debit')
          return total + entry.amountMilliEuro
        if (entry.kind !== 'correction' || entry.direction !== 'credit') return total
        const original = entry.reversesEntryId
          ? entriesById.get(entry.reversesEntryId)
          : undefined
        return original?.kind === 'delivery_charge'
          ? total - entry.amountMilliEuro
          : total
      }, 0)
  )
  const trailingCosts = input.providerCosts.filter(
    (cost) => cost.recordedAt >= trailingSince
  )
  const eurCosts = trailingCosts.filter((cost) => cost.currency === 'EUR')
  const costNanoEuro = eurCosts.reduce(
    (total, cost) =>
      total + BigInt(cost.amountMinorUnits) * 10n ** BigInt(9 - cost.currencyScale),
    0n
  )
  const chargeNanoEuro = BigInt(netMerchantChargeMilliEuro) * 1_000_000n
  const comparableExpectedCosts = expectedRouteCosts.filter(
    (cost) => cost.currency === 'EUR'
  )
  const expectedRouteThresholdBreached = comparableExpectedCosts.some(
    (cost) =>
      BigInt(cost.amountMinorUnits) * 10n ** BigInt(9 - cost.currencyScale) >=
      45_000_000n * BigInt(cost.units)
  )
  const nonEurProviderCostsPresent =
    trailingCosts.length !== eurCosts.length ||
    expectedRouteCosts.length !== comparableExpectedCosts.length
  const ratioStatus =
    chargeNanoEuro === 0n
      ? costNanoEuro === 0n
        ? ('healthy' as const)
        : ('not_comparable' as const)
      : costNanoEuro * 100n >= chargeNanoEuro * 100n
        ? ('critical' as const)
        : costNanoEuro * 100n >= chargeNanoEuro * 80n
          ? ('warning' as const)
          : ('healthy' as const)
  const status = expectedRouteThresholdBreached
    ? ('critical' as const)
    : ratioStatus === 'healthy' && nonEurProviderCostsPresent
      ? ('not_comparable' as const)
      : ratioStatus
  return {
    trailingSince,
    netMerchantChargeMilliEuro,
    comparableProviderCostNanoEuro: costNanoEuro.toString(),
    nonEurProviderCostsPresent,
    expectedRouteThresholdBreached,
    status
  }
}

const thirtyDaysBefore = (asOf: string): string =>
  new Date(new Date(asOf).getTime() - 30 * 24 * 60 * 60 * 1_000).toISOString()

const operationsReconciliation = (
  input: ReconciliationInputs
): typeof OperationsMessagingFinancialReconciliation.Type => ({
  ...input,
  providerCosts: input.providerCosts.map((cost) => ({
    id: cost.id,
    shopId: cost.shopId,
    intentId: cost.intentId,
    attemptId: cost.attemptId,
    provider: cost.provider,
    amountMinorUnits: cost.amountMinorUnits,
    currency: cost.currency,
    currencyScale: cost.currencyScale,
    units: cost.units,
    source: cost.source,
    recordedAt: cost.recordedAt
  }))
})

const deliveryFromRow = (row: DeliveryRow): Delivery => ({
  id: row.id,
  shopId: row.shop_id,
  intentId: row.intent_id,
  reservationId: row.reservation_id,
  rateCardId: row.rate_card_id,
  routeId: row.route_id,
  chargeMilliEuro: row.charge_milli_euro,
  verifiedAt: row.verified_at,
  ledgerEntryId: row.ledger_entry_id
})

const ledgerSelect = `SELECT id, shop_id, direction, kind, amount_milli_euro, currency,
 source_type, source_id, idempotency_key, rate_card_id, intent_id, actor_type, actor_id,
 reason, fiscal_reference, external_fact_id, reverses_entry_id, correction_reason, occurred_at
 FROM messaging_balance_ledger_entries`

const balanceSelect = `SELECT mbs.shop_id, mbs.currency, mbs.posted_milli_euro,
 mbs.reserved_milli_euro, mbs.available_milli_euro, mbs.financially_frozen,
 COALESCE(mmc.low_balance_notice_armed, 1) AS low_balance_notice_armed
 FROM merchant_messaging_balance_summaries mbs
 LEFT JOIN merchant_messaging_controls mmc ON mmc.shop_id = mbs.shop_id`

type SeedMessagingFinanceOptions = {
  readonly rateCards?: readonly RateCard[]
  readonly intents?: readonly {
    readonly id: string
    readonly shopId: string
    readonly createdAt: string
    readonly rateCardId?: string
  }[]
  readonly routes?: readonly {
    readonly id: string
    readonly shopId: string
    readonly intentId: string
    readonly verifiedDelivered?: boolean
  }[]
  readonly financiallyFrozenShopIds?: readonly string[]
}

const launchRateCard: RateCard = {
  id: 'mrcard_launch_v1',
  version: 1,
  currency: 'EUR',
  chargeMilliEuro: 45,
  effectiveAt: '2026-07-29T00:00:00.000Z'
}

export const SeedMessagingFinance = (
  options: SeedMessagingFinanceOptions = {}
): Layer.Layer<MessagingFinance> => {
  const rateCards = [...(options.rateCards ?? [launchRateCard])]
  const intents = new Map((options.intents ?? []).map((intent) => [intent.id, intent]))
  const routes = new Map((options.routes ?? []).map((route) => [route.id, route]))
  const frozen = new Set(options.financiallyFrozenShopIds ?? [])
  const knownShops = new Set((options.intents ?? []).map((intent) => intent.shopId))
  const ledger: LedgerEntry[] = []
  const reservations = new Map<string, Reservation>()
  const deliveries = new Map<string, Delivery>()
  const costs = new Map<string, ProviderCost>()
  const externalFacts = new Map<string, ExternalFact>()
  const externalFactIdentities = new Map<string, string>()
  const lowBalanceNoticeArmed = new Map<string, boolean>()
  let sequence = 0
  const nextId = (prefix: string) => `${prefix}_seed_${++sequence}`

  const balance = (shopId: string): Effect.Effect<Balance, FinanceError> => {
    if (!knownShops.has(shopId))
      return Effect.fail(
        new MessagingFinanceRejected({
          operation: 'balance',
          reason: 'balance_unavailable',
          shopId
        })
      )
    const postedMilliEuro = ledger
      .filter((entry) => entry.shopId === shopId)
      .reduce(
        (total, entry) =>
          total +
          (entry.direction === 'credit'
            ? entry.amountMilliEuro
            : -entry.amountMilliEuro),
        0
      )
    const reservedMilliEuro = [...reservations.values()]
      .filter(
        (reservation) =>
          reservation.shopId === shopId && reservation.status === 'active'
      )
      .reduce((total, reservation) => total + reservation.amountMilliEuro, 0)
    return Effect.succeed({
      shopId,
      currency: 'EUR',
      postedMilliEuro,
      reservedMilliEuro,
      availableMilliEuro: postedMilliEuro - reservedMilliEuro,
      financiallyFrozen: frozen.has(shopId),
      lowBalanceNoticeArmed: lowBalanceNoticeArmed.get(shopId) ?? true
    })
  }

  const bySource = (input: LedgerProvenance) =>
    ledger.find(
      (entry) =>
        entry.sourceType === input.sourceType &&
        entry.sourceId === input.sourceId &&
        entry.idempotencyKey === input.idempotencyKey
    )

  const post = (
    direction: 'credit' | 'debit',
    input: LedgerProvenance & {
      readonly shopId: string
      readonly kind: 'top_up' | 'operator_adjustment' | 'promotional_credit' | 'refund'
      readonly amountMilliEuro: number
    }
  ): Effect.Effect<LedgerEntry, FinanceError> =>
    Effect.gen(function* () {
      if (!Number.isSafeInteger(input.amountMilliEuro) || input.amountMilliEuro <= 0)
        return yield* new MessagingFinanceRejected({
          operation: direction,
          reason: 'invalid_amount',
          shopId: input.shopId
        })
      const policyFailure = validateLedgerPolicy(input)
      if (policyFailure)
        return yield* new MessagingFinanceRejected({
          operation: direction,
          reason: policyFailure,
          shopId: input.shopId
        })
      if (input.kind === 'top_up') {
        const fact = input.externalFactId
          ? externalFacts.get(input.externalFactId)
          : undefined
        if (
          !fact ||
          fact.shopId !== input.shopId ||
          fact.kind !== 'provider_payment' ||
          fact.status !== 'confirmed' ||
          fact.amountMilliEuro !== input.amountMilliEuro ||
          fact.currency !== 'EUR' ||
          fact.sourceId !== input.sourceId
        )
          return yield* new MessagingFinanceRejected({
            operation: direction,
            reason: 'funding_unconfirmed',
            shopId: input.shopId,
            resourceId: input.externalFactId
          })
      }
      const existing = bySource(input)
      if (existing) {
        if (
          existing.shopId !== input.shopId ||
          existing.direction !== direction ||
          existing.kind !== input.kind ||
          existing.amountMilliEuro !== input.amountMilliEuro
        )
          return yield* new MessagingFinanceRejected({
            operation: direction,
            reason: 'idempotency_conflict',
            shopId: input.shopId,
            resourceId: existing.id
          })
        return existing
      }
      knownShops.add(input.shopId)
      if (direction === 'debit') {
        const current = yield* balance(input.shopId)
        if (current.financiallyFrozen)
          return yield* new MessagingFinanceRejected({
            operation: direction,
            reason: 'financially_frozen',
            shopId: input.shopId
          })
        if (current.availableMilliEuro < input.amountMilliEuro)
          return yield* new MessagingFinanceRejected({
            operation: direction,
            reason: 'insufficient_balance',
            shopId: input.shopId
          })
      }
      const entry: LedgerEntry = {
        id: nextId('mle'),
        shopId: input.shopId,
        direction,
        kind: input.kind,
        amountMilliEuro: input.amountMilliEuro,
        currency: 'EUR',
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        idempotencyKey: input.idempotencyKey,
        ...(input.actorType ? { actorType: input.actorType } : {}),
        ...(input.actorId ? { actorId: input.actorId } : {}),
        ...(input.reason ? { reason: input.reason } : {}),
        ...(input.fiscalReference ? { fiscalReference: input.fiscalReference } : {}),
        ...(input.externalFactId ? { externalFactId: input.externalFactId } : {}),
        occurredAt: input.occurredAt
      }
      ledger.push(entry)
      const current = yield* balance(input.shopId)
      if (direction === 'debit' && current.availableMilliEuro < 2_000)
        lowBalanceNoticeArmed.set(input.shopId, false)
      if (
        direction === 'credit' &&
        input.kind === 'top_up' &&
        current.availableMilliEuro >= 2_000
      )
        lowBalanceNoticeArmed.set(input.shopId, true)
      return entry
    })

  const service: MessagingFinanceShape = {
    effectiveRateCard: (at) => {
      const card = rateCards
        .filter(
          (candidate) =>
            candidate.effectiveAt <= at &&
            (!candidate.retiredAt || candidate.retiredAt > at)
        )
        .sort((left, right) => right.version - left.version)[0]
      return card
        ? Effect.succeed(card)
        : Effect.fail(
            new MessagingFinanceRejected({
              operation: 'effective_rate_card',
              reason: 'rate_card_unavailable'
            })
          )
    },
    balance,
    statement: (shopId) =>
      Effect.succeed(ledger.filter((entry) => entry.shopId === shopId)),
    merchantProjection: (shopId) =>
      Effect.map(balance(shopId), (current) => ({
        balance: current,
        transactions: ledger
          .filter((entry) => entry.shopId === shopId)
          .map(merchantTransaction)
      })),
    credit: (input) => post('credit', input),
    debit: (input) => post('debit', input),
    reserve: (input) =>
      Effect.gen(function* () {
        const existing = reservations.get(input.intentId)
        if (existing) {
          if (existing.shopId !== input.shopId)
            return yield* new MessagingFinanceRejected({
              operation: 'reserve',
              reason: 'intent_unavailable',
              shopId: input.shopId,
              resourceId: input.intentId
            })
          return existing
        }
        const intent = intents.get(input.intentId)
        if (!intent || intent.shopId !== input.shopId)
          return yield* new MessagingFinanceRejected({
            operation: 'reserve',
            reason: 'intent_unavailable',
            shopId: input.shopId,
            resourceId: input.intentId
          })
        const card = intent.rateCardId
          ? rateCards.find((candidate) => candidate.id === intent.rateCardId)
          : rateCards
              .filter((candidate) => candidate.effectiveAt <= intent.createdAt)
              .sort((left, right) => right.version - left.version)[0]
        if (!card)
          return yield* new MessagingFinanceRejected({
            operation: 'reserve',
            reason: 'rate_card_unavailable',
            shopId: input.shopId,
            resourceId: input.intentId
          })
        const current = yield* balance(input.shopId)
        if (current.financiallyFrozen)
          return yield* new MessagingFinanceRejected({
            operation: 'reserve',
            reason: 'financially_frozen',
            shopId: input.shopId,
            resourceId: input.intentId
          })
        if (current.availableMilliEuro < card.chargeMilliEuro)
          return yield* new MessagingFinanceRejected({
            operation: 'reserve',
            reason: 'insufficient_balance',
            shopId: input.shopId,
            resourceId: input.intentId
          })
        const reservation: Reservation = {
          id: nextId('mbr'),
          shopId: input.shopId,
          intentId: input.intentId,
          rateCardId: card.id,
          amountMilliEuro: card.chargeMilliEuro,
          status: 'active',
          expiresAt: input.expiresAt
        }
        reservations.set(input.intentId, reservation)
        const after = yield* balance(input.shopId)
        if (after.availableMilliEuro < 2_000)
          lowBalanceNoticeArmed.set(input.shopId, false)
        return reservation
      }),
    release: (input) => {
      const reservation = reservations.get(input.intentId)
      if (!reservation || reservation.shopId !== input.shopId)
        return Effect.fail(
          new MessagingFinanceRejected({
            operation: 'release',
            reason: 'reservation_unavailable',
            shopId: input.shopId,
            resourceId: input.intentId
          })
        )
      if (reservation.status === 'active') {
        const released: Reservation = {
          ...reservation,
          status: 'released',
          releasedAt: input.releasedAt,
          releaseReason: input.reason
        }
        reservations.set(input.intentId, released)
        return Effect.succeed(released)
      }
      return Effect.succeed(reservation)
    },
    convertDelivery: (input) =>
      Effect.gen(function* () {
        const existing = deliveries.get(input.intentId)
        if (existing) {
          if (existing.shopId !== input.shopId)
            return yield* new MessagingFinanceRejected({
              operation: 'convert_delivery',
              reason: 'reservation_not_active',
              shopId: input.shopId,
              resourceId: input.intentId
            })
          return existing
        }
        const reservation = reservations.get(input.intentId)
        if (
          !reservation ||
          reservation.shopId !== input.shopId ||
          reservation.status !== 'active'
        )
          return yield* new MessagingFinanceRejected({
            operation: 'convert_delivery',
            reason: 'reservation_not_active',
            shopId: input.shopId,
            resourceId: input.intentId
          })
        const route = routes.get(input.routeId)
        if (
          !route ||
          route.shopId !== input.shopId ||
          route.intentId !== input.intentId ||
          route.verifiedDelivered !== true
        )
          return yield* new MessagingFinanceRejected({
            operation: 'convert_delivery',
            reason: 'route_unavailable',
            shopId: input.shopId,
            resourceId: input.routeId
          })
        const converted: Reservation = {
          ...reservation,
          status: 'converted',
          convertedAt: input.verifiedAt
        }
        reservations.set(input.intentId, converted)
        const ledgerEntry: LedgerEntry = {
          id: nextId('mle'),
          shopId: input.shopId,
          direction: 'debit',
          kind: 'delivery_charge',
          amountMilliEuro: reservation.amountMilliEuro,
          currency: 'EUR',
          sourceType: 'notification_intent',
          sourceId: input.intentId,
          idempotencyKey: `delivery:${input.intentId}`,
          rateCardId: reservation.rateCardId,
          intentId: input.intentId,
          occurredAt: input.verifiedAt
        }
        ledger.push(ledgerEntry)
        const delivery: Delivery = {
          id: nextId('mcd'),
          shopId: input.shopId,
          intentId: input.intentId,
          reservationId: reservation.id,
          rateCardId: reservation.rateCardId,
          routeId: input.routeId,
          chargeMilliEuro: reservation.amountMilliEuro,
          verifiedAt: input.verifiedAt,
          ledgerEntryId: ledgerEntry.id
        }
        deliveries.set(input.intentId, delivery)
        return delivery
      }),
    correct: (input) =>
      Effect.gen(function* () {
        const provenanceFailure = validateCorrectionProvenance(input)
        if (provenanceFailure)
          return yield* new MessagingFinanceRejected({
            operation: 'correct',
            reason: provenanceFailure,
            shopId: input.shopId,
            resourceId: input.entryId
          })
        const original = ledger.find(
          (entry) => entry.id === input.entryId && entry.shopId === input.shopId
        )
        if (!original)
          return yield* new MessagingFinanceRejected({
            operation: 'correct',
            reason: 'entry_unavailable',
            shopId: input.shopId,
            resourceId: input.entryId
          })
        if (original.kind === 'correction')
          return yield* new MessagingFinanceRejected({
            operation: 'correct',
            reason: 'invalid_correction',
            shopId: input.shopId,
            resourceId: input.entryId
          })
        const existing = bySource(input)
        if (existing) {
          if (
            existing.kind !== 'correction' ||
            existing.reversesEntryId !== original.id ||
            existing.correctionReason !== input.correctionReason
          )
            return yield* new MessagingFinanceRejected({
              operation: 'correct',
              reason: 'idempotency_conflict',
              shopId: input.shopId,
              resourceId: existing.id
            })
          return existing
        }
        const sameCorrection = ledger.find(
          (entry) =>
            entry.reversesEntryId === original.id &&
            entry.correctionReason === input.correctionReason
        )
        if (sameCorrection) return sameCorrection
        const direction = original.direction === 'debit' ? 'credit' : 'debit'
        if (direction === 'debit') {
          const current = yield* balance(input.shopId)
          if (current.availableMilliEuro < original.amountMilliEuro)
            return yield* new MessagingFinanceRejected({
              operation: 'correct',
              reason: 'insufficient_balance',
              shopId: input.shopId,
              resourceId: original.id
            })
        }
        const correction: LedgerEntry = {
          id: nextId('mle'),
          shopId: input.shopId,
          direction,
          kind: 'correction',
          amountMilliEuro: original.amountMilliEuro,
          currency: 'EUR',
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          idempotencyKey: input.idempotencyKey,
          ...(input.actorType ? { actorType: input.actorType } : {}),
          ...(input.actorId ? { actorId: input.actorId } : {}),
          ...(input.reason ? { reason: input.reason } : {}),
          reversesEntryId: original.id,
          correctionReason: input.correctionReason,
          occurredAt: input.occurredAt
        }
        ledger.push(correction)
        if (direction === 'debit') {
          const current = yield* balance(input.shopId)
          if (current.availableMilliEuro < 2_000)
            lowBalanceNoticeArmed.set(input.shopId, false)
        }
        return correction
      }),
    recordProviderCost: (input) =>
      Effect.gen(function* () {
        if (
          !Number.isSafeInteger(input.amountMinorUnits) ||
          input.amountMinorUnits < 0 ||
          !Number.isSafeInteger(input.currencyScale) ||
          input.currencyScale < 0 ||
          input.currencyScale > 9 ||
          !Number.isSafeInteger(input.units) ||
          input.units <= 0 ||
          !Number.isSafeInteger(input.unitOrdinal) ||
          input.unitOrdinal < 0
        )
          return yield* new MessagingFinanceRejected({
            operation: 'record_provider_cost',
            reason: 'invalid_amount',
            shopId: input.shopId,
            resourceId: input.attemptId
          })
        const key = [
          input.environment,
          input.provider,
          input.providerAccountKey,
          input.billingIdentityFingerprint,
          input.unitOrdinal
        ].join(':')
        const existing = costs.get(key)
        if (existing) {
          if (
            existing.shopId !== input.shopId ||
            existing.intentId !== input.intentId ||
            existing.attemptId !== input.attemptId ||
            existing.amountMinorUnits !== input.amountMinorUnits ||
            existing.currency !== input.currency ||
            existing.currencyScale !== input.currencyScale ||
            existing.units !== input.units ||
            existing.source !== input.source
          )
            return yield* new MessagingFinanceRejected({
              operation: 'record_provider_cost',
              reason: 'idempotency_conflict',
              shopId: input.shopId,
              resourceId: existing.id
            })
          return existing
        }
        const cost: ProviderCost = {
          id: nextId('pmc'),
          shopId: input.shopId,
          intentId: input.intentId,
          attemptId: input.attemptId,
          environment: input.environment,
          provider: input.provider,
          unitOrdinal: input.unitOrdinal,
          amountMinorUnits: input.amountMinorUnits,
          currency: input.currency,
          currencyScale: input.currencyScale,
          units: input.units,
          source: input.source,
          recordedAt: input.recordedAt
        }
        costs.set(key, cost)
        return cost
      }),
    recordExternalFact: (input) => {
      const identity = [input.kind, input.provider, input.sourceId, input.status].join(
        ':'
      )
      const existingId = externalFactIdentities.get(identity)
      if (existingId) {
        const existing = externalFacts.get(existingId)!
        return existing.shopId === input.shopId &&
          existing.amountMilliEuro === input.amountMilliEuro &&
          existing.currency === input.currency &&
          existing.reference === input.reference &&
          existing.relatedSourceId === input.relatedSourceId
          ? Effect.succeed(existing)
          : Effect.fail(
              new MessagingFinanceRejected({
                operation: 'record_external_fact',
                reason: 'idempotency_conflict',
                shopId: input.shopId,
                resourceId: existing.id
              })
            )
      }
      const fact: ExternalFact = { id: nextId('mff'), ...input }
      externalFacts.set(fact.id, fact)
      externalFactIdentities.set(identity, fact.id)
      knownShops.add(input.shopId)
      return Effect.succeed(fact)
    },
    reconciliationInputs: (shopId) =>
      Effect.map(balance(shopId), (current) => {
        const ledgerEntries = ledger.filter((entry) => entry.shopId === shopId)
        const shopReservations = [...reservations.values()].filter(
          (reservation) => reservation.shopId === shopId
        )
        const chargeableDeliveries = [...deliveries.values()].filter(
          (delivery) => delivery.shopId === shopId
        )
        const providerCosts = [...costs.values()].filter(
          (cost) => cost.shopId === shopId
        )
        const shopExternalFacts = [...externalFacts.values()].filter(
          (fact) => fact.shopId === shopId
        )
        return {
          shopId,
          balance: current,
          ledgerEntries,
          reservations: shopReservations,
          chargeableDeliveries,
          providerCosts,
          externalFacts: shopExternalFacts,
          openCaseIds: [],
          ...reconciliationMetadata(ledgerEntries),
          ledgerEntryCount: ledgerEntries.length,
          activeReservationCount: shopReservations.filter(
            (reservation) => reservation.status === 'active'
          ).length,
          chargeableDeliveryCount: chargeableDeliveries.length,
          providerCostCount: providerCosts.length,
          openCaseCount: 0
        }
      }),
    operationsProjection: (input) =>
      Effect.gen(function* () {
        const reconciliation = yield* service.reconciliationInputs(input.shopId)
        return {
          rateCards: [...rateCards].sort((left, right) => left.version - right.version),
          reconciliation: operationsReconciliation(reconciliation),
          margin: deriveMarginProjection(
            reconciliation,
            thirtyDaysBefore(input.asOf),
            input.expectedRouteCosts
          )
        }
      })
  }
  return Layer.succeed(MessagingFinance)(service)
}

export const LiveMessagingFinance: Layer.Layer<MessagingFinance, never, Database> =
  Layer.effect(
    MessagingFinance,
    Effect.gen(function* () {
      const db = yield* Database
      const raw = db.$client.config.db

      const readBalance = (shopId: string): Effect.Effect<Balance, FinanceError> =>
        Effect.flatMap(
          first<BalanceRow>(raw, `${balanceSelect} WHERE mbs.shop_id = ?`, shopId),
          (row) =>
            row
              ? Effect.succeed(balanceFromRow(row))
              : Effect.fail(
                  new MessagingFinanceRejected({
                    operation: 'balance',
                    reason: 'balance_unavailable',
                    shopId
                  })
                )
        )

      const readLedgerBySource = (
        sourceType: string,
        sourceId: string,
        idempotencyKey: string
      ) =>
        Effect.map(
          first<LedgerRow>(
            raw,
            `${ledgerSelect} WHERE source_type = ? AND source_id = ? AND idempotency_key = ?`,
            sourceType,
            sourceId,
            idempotencyKey
          ),
          (row) => (row ? ledgerFromRow(row) : undefined)
        )

      const post = (
        direction: 'credit' | 'debit',
        input: LedgerProvenance & {
          readonly shopId: string
          readonly kind:
            | 'top_up'
            | 'operator_adjustment'
            | 'promotional_credit'
            | 'refund'
          readonly amountMilliEuro: number
        }
      ): Effect.Effect<LedgerEntry, FinanceError> =>
        Effect.gen(function* () {
          if (
            !Number.isSafeInteger(input.amountMilliEuro) ||
            input.amountMilliEuro <= 0
          )
            return yield* new MessagingFinanceRejected({
              operation: direction,
              reason: 'invalid_amount',
              shopId: input.shopId
            })
          const policyFailure = validateLedgerPolicy(input)
          if (policyFailure)
            return yield* new MessagingFinanceRejected({
              operation: direction,
              reason: policyFailure,
              shopId: input.shopId
            })
          if (input.kind === 'top_up') {
            const fact = yield* first<ExternalFactRow>(
              raw,
              `SELECT * FROM messaging_financial_external_facts
               WHERE id = ? AND shop_id = ?`,
              input.externalFactId,
              input.shopId
            )
            if (
              !fact ||
              fact.kind !== 'provider_payment' ||
              fact.status !== 'confirmed' ||
              fact.amount_milli_euro !== input.amountMilliEuro ||
              fact.currency !== 'EUR' ||
              fact.source_id !== input.sourceId
            )
              return yield* new MessagingFinanceRejected({
                operation: direction,
                reason: 'funding_unconfirmed',
                shopId: input.shopId,
                resourceId: input.externalFactId
              })
          }
          const existing = yield* readLedgerBySource(
            input.sourceType,
            input.sourceId,
            input.idempotencyKey
          )
          if (existing) {
            if (
              existing.shopId !== input.shopId ||
              existing.direction !== direction ||
              existing.kind !== input.kind ||
              existing.amountMilliEuro !== input.amountMilliEuro
            )
              return yield* new MessagingFinanceRejected({
                operation: direction,
                reason: 'idempotency_conflict',
                shopId: input.shopId,
                resourceId: existing.id
              })
            return existing
          }
          const entryId = id('mle')
          const insertSql =
            direction === 'credit'
              ? `INSERT OR IGNORE INTO messaging_balance_ledger_entries
                (id, shop_id, direction, kind, amount_milli_euro, currency, source_type,
                 source_id, idempotency_key, actor_type, actor_id, reason, fiscal_reference,
                 external_fact_id, occurred_at, created_at)
                VALUES (?, ?, ?, ?, ?, 'EUR', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              : `INSERT OR IGNORE INTO messaging_balance_ledger_entries
                (id, shop_id, direction, kind, amount_milli_euro, currency, source_type,
                 source_id, idempotency_key, actor_type, actor_id, reason, fiscal_reference,
                 external_fact_id, occurred_at, created_at)
                SELECT ?, ?, ?, ?, ?, 'EUR', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                FROM merchant_messaging_balance_summaries
                WHERE shop_id = ? AND financially_frozen = 0
                  AND available_milli_euro >= ?`
          const insertParams = [
            entryId,
            input.shopId,
            direction,
            input.kind,
            input.amountMilliEuro,
            input.sourceType,
            input.sourceId,
            input.idempotencyKey,
            input.actorType ?? null,
            input.actorId ?? null,
            input.reason ?? null,
            input.fiscalReference ?? null,
            input.externalFactId ?? null,
            input.occurredAt,
            input.occurredAt,
            ...(direction === 'debit' ? [input.shopId, input.amountMilliEuro] : [])
          ]
          const noticeStatement =
            direction === 'debit'
              ? {
                  sql: `UPDATE merchant_messaging_controls
                    SET low_balance_notice_armed = 0, updated_at = ?
                    WHERE shop_id = ? AND low_balance_notice_armed = 1 AND changes() = 1
                      AND EXISTS (
                        SELECT 1 FROM merchant_messaging_balance_summaries balance
                        WHERE balance.shop_id = ? AND balance.available_milli_euro < 2000
                      )`,
                  params: [input.occurredAt, input.shopId, input.shopId]
                }
              : input.kind === 'top_up'
                ? {
                    sql: `UPDATE merchant_messaging_controls
                      SET low_balance_notice_armed = 1, updated_at = ?
                      WHERE shop_id = ? AND low_balance_notice_armed = 0 AND changes() = 1
                        AND EXISTS (
                          SELECT 1 FROM merchant_messaging_balance_summaries balance
                          WHERE balance.shop_id = ? AND balance.available_milli_euro >= 2000
                        )`,
                    params: [input.occurredAt, input.shopId, input.shopId]
                  }
                : undefined
          const results = yield* batch(raw, [
            {
              sql: `INSERT OR IGNORE INTO messaging_balances
                (shop_id, currency, financially_frozen, created_at, updated_at)
                VALUES (?, 'EUR', 0, ?, ?)`,
              params: [input.shopId, input.occurredAt, input.occurredAt]
            },
            {
              sql: insertSql,
              params: insertParams
            },
            ...(noticeStatement ? [noticeStatement] : [])
          ])
          if ((results[1]?.meta.changes ?? 0) !== 1) {
            const racing = yield* readLedgerBySource(
              input.sourceType,
              input.sourceId,
              input.idempotencyKey
            )
            if (racing) {
              if (
                racing.shopId === input.shopId &&
                racing.direction === direction &&
                racing.kind === input.kind &&
                racing.amountMilliEuro === input.amountMilliEuro
              )
                return racing
              return yield* new MessagingFinanceRejected({
                operation: direction,
                reason: 'idempotency_conflict',
                shopId: input.shopId,
                resourceId: racing.id
              })
            }
            if (direction === 'debit') {
              const current = yield* readBalance(input.shopId)
              return yield* new MessagingFinanceRejected({
                operation: direction,
                reason: current.financiallyFrozen
                  ? 'financially_frozen'
                  : 'insufficient_balance',
                shopId: input.shopId
              })
            }
            return yield* new MessagingFinanceRejected({
              operation: direction,
              reason: 'idempotency_conflict',
              shopId: input.shopId
            })
          }
          const stored = yield* readLedgerBySource(
            input.sourceType,
            input.sourceId,
            input.idempotencyKey
          )
          if (!stored) return yield* unavailable('ledger entry missing after commit')
          return stored
        })

      const readStatement = (shopId: string) =>
        Effect.map(
          all<LedgerRow>(
            raw,
            `${ledgerSelect} WHERE shop_id = ? ORDER BY occurred_at, id`,
            shopId
          ),
          (rows) => rows.map(ledgerFromRow)
        )

      const readReconciliation = (
        shopId: string
      ): Effect.Effect<ReconciliationInputs, FinanceError> =>
        Effect.gen(function* () {
          const result = yield* Effect.all({
            balance: readBalance(shopId),
            ledgerEntries: readStatement(shopId),
            reservationRows: all<ReservationRow>(
              raw,
              `SELECT * FROM messaging_balance_reservations
               WHERE shop_id = ? ORDER BY created_at, id`,
              shopId
            ),
            deliveryRows: all<DeliveryRow>(
              raw,
              `SELECT cd.*, mle.id AS ledger_entry_id
               FROM chargeable_deliveries cd
               JOIN messaging_balance_ledger_entries mle
                 ON mle.shop_id = cd.shop_id AND mle.intent_id = cd.intent_id
                AND mle.kind = 'delivery_charge'
               WHERE cd.shop_id = ? ORDER BY cd.created_at, cd.id`,
              shopId
            ),
            costRows: all<ProviderCostRow>(
              raw,
              `SELECT * FROM provider_messaging_costs
               WHERE shop_id = ? ORDER BY recorded_at, id`,
              shopId
            ),
            externalFactRows: all<ExternalFactRow>(
              raw,
              `SELECT * FROM messaging_financial_external_facts
               WHERE shop_id = ? ORDER BY observed_at, id`,
              shopId
            ),
            caseRows: all<{ id: string }>(
              raw,
              `SELECT id FROM messaging_reconciliation_cases
               WHERE shop_id = ? AND status IN ('open', 'investigating')
               ORDER BY opened_at, id`,
              shopId
            )
          })
          const reservations = result.reservationRows.map(reservationFromRow)
          const chargeableDeliveries = result.deliveryRows.map(deliveryFromRow)
          const providerCosts = result.costRows.map(providerCostFromRow)
          const externalFacts = result.externalFactRows.map(externalFactFromRow)
          return {
            shopId,
            balance: result.balance,
            ledgerEntries: result.ledgerEntries,
            reservations,
            chargeableDeliveries,
            providerCosts,
            externalFacts,
            openCaseIds: result.caseRows.map((row) => row.id),
            ...reconciliationMetadata(result.ledgerEntries),
            ledgerEntryCount: result.ledgerEntries.length,
            activeReservationCount: reservations.filter(
              (reservation) => reservation.status === 'active'
            ).length,
            chargeableDeliveryCount: chargeableDeliveries.length,
            providerCostCount: providerCosts.length,
            openCaseCount: result.caseRows.length
          }
        })

      const service: MessagingFinanceShape = {
        effectiveRateCard: (at) =>
          Effect.flatMap(
            first<RateCardRow>(
              raw,
              `SELECT id, version, currency, charge_milli_euro, effective_at,
                notice_published_at, retired_at
               FROM messaging_rate_cards
               WHERE effective_at <= ? AND (retired_at IS NULL OR retired_at > ?)
               ORDER BY effective_at DESC, version DESC LIMIT 1`,
              at,
              at
            ),
            (row) =>
              row
                ? Effect.succeed(rateCardFromRow(row))
                : Effect.fail(
                    new MessagingFinanceRejected({
                      operation: 'effective_rate_card',
                      reason: 'rate_card_unavailable'
                    })
                  )
          ),
        balance: readBalance,
        statement: readStatement,
        merchantProjection: (shopId) =>
          Effect.all({
            balance: readBalance(shopId),
            transactions: Effect.map(readStatement(shopId), (entries) =>
              entries.map(merchantTransaction)
            )
          }),
        credit: (input) => post('credit', input),
        debit: (input) => post('debit', input),
        reserve: (input) =>
          Effect.gen(function* () {
            const existing = yield* first<ReservationRow>(
              raw,
              `SELECT * FROM messaging_balance_reservations WHERE intent_id = ? AND shop_id = ?`,
              input.intentId,
              input.shopId
            )
            if (existing) return reservationFromRow(existing)
            const reservationId = id('mbr')
            const results = yield* batch(raw, [
              {
                sql: `INSERT OR IGNORE INTO messaging_balances
                  (shop_id, currency, financially_frozen, created_at, updated_at)
                  VALUES (?, 'EUR', 0, ?, ?)`,
                params: [input.shopId, input.reservedAt, input.reservedAt]
              },
              {
                sql: `UPDATE notification_intents
                  SET rate_card_id = COALESCE(rate_card_id, (
                    SELECT id FROM messaging_rate_cards
                    WHERE effective_at <= notification_intents.created_at
                      AND (retired_at IS NULL OR retired_at > notification_intents.created_at)
                    ORDER BY effective_at DESC, version DESC LIMIT 1
                  )), updated_at = ?
                  WHERE id = ? AND shop_id = ?`,
                params: [input.reservedAt, input.intentId, input.shopId]
              },
              {
                sql: `INSERT OR IGNORE INTO messaging_balance_reservations
                  (id, shop_id, intent_id, rate_card_id, amount_milli_euro, status,
                   expires_at, created_at, updated_at)
                  SELECT ?, ni.shop_id, ni.id, rc.id, rc.charge_milli_euro, 'active', ?, ?, ?
                  FROM notification_intents ni
                  JOIN messaging_rate_cards rc ON rc.id = ni.rate_card_id
                  JOIN merchant_messaging_balance_summaries balance ON balance.shop_id = ni.shop_id
                  WHERE ni.id = ? AND ni.shop_id = ?
                    AND balance.financially_frozen = 0
                    AND balance.available_milli_euro >= rc.charge_milli_euro`,
                params: [
                  reservationId,
                  input.expiresAt,
                  input.reservedAt,
                  input.reservedAt,
                  input.intentId,
                  input.shopId
                ]
              },
              {
                sql: `UPDATE merchant_messaging_controls
                  SET low_balance_notice_armed = 0, updated_at = ?
                  WHERE shop_id = ? AND low_balance_notice_armed = 1 AND changes() = 1
                    AND EXISTS (
                      SELECT 1 FROM merchant_messaging_balance_summaries balance
                      WHERE balance.shop_id = ? AND balance.available_milli_euro < 2000
                    )`,
                params: [input.reservedAt, input.shopId, input.shopId]
              }
            ])
            if ((results[2]?.meta.changes ?? 0) !== 1) {
              const racingReservation = yield* first<ReservationRow>(
                raw,
                `SELECT * FROM messaging_balance_reservations
                 WHERE intent_id = ? AND shop_id = ?`,
                input.intentId,
                input.shopId
              )
              if (racingReservation) return reservationFromRow(racingReservation)
              const intent = yield* first<{ id: string; rate_card_id: string | null }>(
                raw,
                `SELECT id, rate_card_id FROM notification_intents WHERE id = ? AND shop_id = ?`,
                input.intentId,
                input.shopId
              )
              if (!intent)
                return yield* new MessagingFinanceRejected({
                  operation: 'reserve',
                  reason: 'intent_unavailable',
                  shopId: input.shopId,
                  resourceId: input.intentId
                })
              if (!intent.rate_card_id)
                return yield* new MessagingFinanceRejected({
                  operation: 'reserve',
                  reason: 'rate_card_unavailable',
                  shopId: input.shopId,
                  resourceId: input.intentId
                })
              const current = yield* readBalance(input.shopId)
              return yield* new MessagingFinanceRejected({
                operation: 'reserve',
                reason: current.financiallyFrozen
                  ? 'financially_frozen'
                  : 'insufficient_balance',
                shopId: input.shopId,
                resourceId: input.intentId
              })
            }
            const stored = yield* first<ReservationRow>(
              raw,
              `SELECT * FROM messaging_balance_reservations WHERE id = ?`,
              reservationId
            )
            if (!stored) return yield* unavailable('reservation missing after commit')
            return reservationFromRow(stored)
          }),
        release: (input) =>
          Effect.gen(function* () {
            yield* tryDb(() =>
              raw
                .prepare(
                  `UPDATE messaging_balance_reservations
                   SET status = 'released', released_at = ?, release_reason = ?, updated_at = ?
                   WHERE intent_id = ? AND shop_id = ? AND status = 'active'`
                )
                .bind(
                  input.releasedAt,
                  input.reason,
                  input.releasedAt,
                  input.intentId,
                  input.shopId
                )
                .run()
            )
            const row = yield* first<ReservationRow>(
              raw,
              `SELECT * FROM messaging_balance_reservations WHERE intent_id = ? AND shop_id = ?`,
              input.intentId,
              input.shopId
            )
            if (!row)
              return yield* new MessagingFinanceRejected({
                operation: 'release',
                reason: 'reservation_unavailable',
                shopId: input.shopId,
                resourceId: input.intentId
              })
            return reservationFromRow(row)
          }),
        convertDelivery: (input) =>
          Effect.gen(function* () {
            const selectDelivery = () =>
              first<DeliveryRow>(
                raw,
                `SELECT cd.*, mle.id AS ledger_entry_id
                 FROM chargeable_deliveries cd
                 JOIN messaging_balance_ledger_entries mle
                   ON mle.shop_id = cd.shop_id AND mle.intent_id = cd.intent_id
                  AND mle.kind = 'delivery_charge'
                 WHERE cd.intent_id = ? AND cd.shop_id = ?`,
                input.intentId,
                input.shopId
              )
            const existing = yield* selectDelivery()
            if (existing) return deliveryFromRow(existing)
            const deliveryId = id('mcd')
            const entryId = id('mle')
            const results = yield* batch(raw, [
              {
                sql: `UPDATE messaging_balance_reservations
                  SET status = 'converted', converted_at = ?, updated_at = ?
                  WHERE intent_id = ? AND shop_id = ? AND status = 'active'
                    AND EXISTS (
                      SELECT 1 FROM delivery_routes route
                      WHERE route.id = ? AND route.shop_id = ? AND route.intent_id = ?
                        AND route.state = 'delivered'
                        AND EXISTS (
                          SELECT 1 FROM provider_evidence evidence
                          WHERE evidence.route_id = route.id
                            AND evidence.shop_id = route.shop_id
                            AND evidence.intent_id = route.intent_id
                            AND evidence.trusted = 1
                            AND evidence.status IN ('delivered', 'read')
                        )
                    )`,
                params: [
                  input.verifiedAt,
                  input.verifiedAt,
                  input.intentId,
                  input.shopId,
                  input.routeId,
                  input.shopId,
                  input.intentId
                ]
              },
              {
                sql: `INSERT INTO chargeable_deliveries
                  (id, shop_id, intent_id, reservation_id, rate_card_id, route_id,
                   charge_milli_euro, verified_at, created_at)
                  SELECT ?, r.shop_id, r.intent_id, r.id, r.rate_card_id, ?,
                    r.amount_milli_euro, ?, ?
                  FROM messaging_balance_reservations r
                  JOIN delivery_routes route
                    ON route.id = ? AND route.shop_id = r.shop_id AND route.intent_id = r.intent_id
                  WHERE r.intent_id = ? AND r.shop_id = ? AND changes() = 1`,
                params: [
                  deliveryId,
                  input.routeId,
                  input.verifiedAt,
                  input.verifiedAt,
                  input.routeId,
                  input.intentId,
                  input.shopId
                ]
              },
              {
                sql: `INSERT INTO messaging_balance_ledger_entries
                  (id, shop_id, direction, kind, amount_milli_euro, currency, source_type,
                   source_id, idempotency_key, rate_card_id, intent_id, occurred_at, created_at)
                  SELECT ?, r.shop_id, 'debit', 'delivery_charge', r.amount_milli_euro,
                    'EUR', 'notification_intent', r.intent_id, 'delivery:' || r.intent_id,
                    r.rate_card_id, r.intent_id, ?, ?
                  FROM messaging_balance_reservations r
                  WHERE r.intent_id = ? AND r.shop_id = ? AND changes() = 1`,
                params: [
                  entryId,
                  input.verifiedAt,
                  input.verifiedAt,
                  input.intentId,
                  input.shopId
                ]
              }
            ])
            if ((results[0]?.meta.changes ?? 0) !== 1) {
              const racingDelivery = yield* selectDelivery()
              if (racingDelivery) return deliveryFromRow(racingDelivery)
              const reservation = yield* first<{ status: Reservation['status'] }>(
                raw,
                `SELECT status FROM messaging_balance_reservations
                 WHERE intent_id = ? AND shop_id = ?`,
                input.intentId,
                input.shopId
              )
              return yield* new MessagingFinanceRejected({
                operation: 'convert_delivery',
                reason:
                  reservation?.status === 'active'
                    ? 'route_unavailable'
                    : 'reservation_not_active',
                shopId: input.shopId,
                resourceId:
                  reservation?.status === 'active' ? input.routeId : input.intentId
              })
            }
            const stored = yield* selectDelivery()
            if (!stored)
              return yield* unavailable('chargeable delivery missing after commit')
            return deliveryFromRow(stored)
          }),
        correct: (input) =>
          Effect.gen(function* () {
            const provenanceFailure = validateCorrectionProvenance(input)
            if (provenanceFailure)
              return yield* new MessagingFinanceRejected({
                operation: 'correct',
                reason: provenanceFailure,
                shopId: input.shopId,
                resourceId: input.entryId
              })
            const originalRow = yield* first<LedgerRow>(
              raw,
              `${ledgerSelect} WHERE id = ? AND shop_id = ?`,
              input.entryId,
              input.shopId
            )
            if (!originalRow)
              return yield* new MessagingFinanceRejected({
                operation: 'correct',
                reason: 'entry_unavailable',
                shopId: input.shopId,
                resourceId: input.entryId
              })
            const original = ledgerFromRow(originalRow)
            if (original.kind === 'correction')
              return yield* new MessagingFinanceRejected({
                operation: 'correct',
                reason: 'invalid_correction',
                shopId: input.shopId,
                resourceId: input.entryId
              })
            const existing = yield* readLedgerBySource(
              input.sourceType,
              input.sourceId,
              input.idempotencyKey
            )
            if (existing) {
              if (
                existing.kind !== 'correction' ||
                existing.reversesEntryId !== original.id ||
                existing.correctionReason !== input.correctionReason
              )
                return yield* new MessagingFinanceRejected({
                  operation: 'correct',
                  reason: 'idempotency_conflict',
                  shopId: input.shopId,
                  resourceId: existing.id
                })
              return existing
            }
            const existingReversal = yield* first<LedgerRow>(
              raw,
              `${ledgerSelect} WHERE reverses_entry_id = ? AND correction_reason = ?`,
              original.id,
              input.correctionReason
            )
            if (existingReversal) return ledgerFromRow(existingReversal)
            const direction = original.direction === 'debit' ? 'credit' : 'debit'
            const correctionId = id('mle')
            const guard =
              direction === 'debit'
                ? `AND EXISTS (
                    SELECT 1 FROM merchant_messaging_balance_summaries balance
                    WHERE balance.shop_id = ? AND balance.financially_frozen = 0
                      AND balance.available_milli_euro >= ?
                  )`
                : ''
            const results = yield* batch(raw, [
              {
                sql: `INSERT OR IGNORE INTO messaging_balance_ledger_entries
                  (id, shop_id, direction, kind, amount_milli_euro, currency, source_type,
                   source_id, idempotency_key, actor_type, actor_id, reason,
                   reverses_entry_id, correction_reason, occurred_at, created_at)
                  SELECT ?, ?, ?, 'correction', ?, 'EUR', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                  WHERE 1 = 1 ${guard}`,
                params: [
                  correctionId,
                  input.shopId,
                  direction,
                  original.amountMilliEuro,
                  input.sourceType,
                  input.sourceId,
                  input.idempotencyKey,
                  input.actorType ?? null,
                  input.actorId ?? null,
                  input.reason ?? null,
                  original.id,
                  input.correctionReason,
                  input.occurredAt,
                  input.occurredAt,
                  ...(direction === 'debit'
                    ? [input.shopId, original.amountMilliEuro]
                    : [])
                ]
              },
              ...(direction === 'debit'
                ? [
                    {
                      sql: `UPDATE merchant_messaging_controls
                        SET low_balance_notice_armed = 0, updated_at = ?
                        WHERE shop_id = ? AND low_balance_notice_armed = 1
                          AND changes() = 1
                          AND EXISTS (
                            SELECT 1 FROM merchant_messaging_balance_summaries balance
                            WHERE balance.shop_id = ?
                              AND balance.available_milli_euro < 2000
                          )`,
                      params: [input.occurredAt, input.shopId, input.shopId]
                    }
                  ]
                : [])
            ])
            if ((results[0]?.meta.changes ?? 0) !== 1) {
              const racing = yield* readLedgerBySource(
                input.sourceType,
                input.sourceId,
                input.idempotencyKey
              )
              if (
                racing?.kind === 'correction' &&
                racing.reversesEntryId === original.id &&
                racing.correctionReason === input.correctionReason
              )
                return racing
              const racingReversal = yield* first<LedgerRow>(
                raw,
                `${ledgerSelect} WHERE reverses_entry_id = ? AND correction_reason = ?`,
                original.id,
                input.correctionReason
              )
              if (racingReversal) return ledgerFromRow(racingReversal)
              return yield* new MessagingFinanceRejected({
                operation: 'correct',
                reason:
                  direction === 'debit'
                    ? 'insufficient_balance'
                    : 'idempotency_conflict',
                shopId: input.shopId,
                resourceId: original.id
              })
            }
            const stored = yield* readLedgerBySource(
              input.sourceType,
              input.sourceId,
              input.idempotencyKey
            )
            if (!stored) return yield* unavailable('correction missing after commit')
            return stored
          }),
        recordProviderCost: (input) =>
          Effect.gen(function* () {
            if (
              !Number.isSafeInteger(input.amountMinorUnits) ||
              input.amountMinorUnits < 0 ||
              !Number.isSafeInteger(input.currencyScale) ||
              input.currencyScale < 0 ||
              input.currencyScale > 9 ||
              !Number.isSafeInteger(input.units) ||
              input.units <= 0 ||
              !Number.isSafeInteger(input.unitOrdinal) ||
              input.unitOrdinal < 0
            )
              return yield* new MessagingFinanceRejected({
                operation: 'record_provider_cost',
                reason: 'invalid_amount',
                shopId: input.shopId,
                resourceId: input.attemptId
              })
            const selectCost = () =>
              first<ProviderCostRow>(
                raw,
                `SELECT * FROM provider_messaging_costs
                 WHERE environment = ? AND provider = ? AND provider_account_key = ?
                   AND billing_identity_fingerprint = ? AND unit_ordinal = ?`,
                input.environment,
                input.provider,
                input.providerAccountKey,
                input.billingIdentityFingerprint,
                input.unitOrdinal
              )
            const existingRow = yield* selectCost()
            if (existingRow) {
              const existing = providerCostFromRow(existingRow)
              if (
                existing.shopId !== input.shopId ||
                existing.intentId !== input.intentId ||
                existing.attemptId !== input.attemptId ||
                existing.amountMinorUnits !== input.amountMinorUnits ||
                existing.currency !== input.currency ||
                existing.currencyScale !== input.currencyScale ||
                existing.units !== input.units ||
                existing.source !== input.source
              )
                return yield* new MessagingFinanceRejected({
                  operation: 'record_provider_cost',
                  reason: 'idempotency_conflict',
                  shopId: input.shopId,
                  resourceId: existing.id
                })
              return existing
            }
            const costId = id('pmc')
            yield* tryDb(() =>
              raw
                .prepare(
                  `INSERT OR IGNORE INTO provider_messaging_costs
                   (id, shop_id, intent_id, attempt_id, environment, provider,
                    provider_account_key, billing_identity_fingerprint, unit_ordinal,
                    amount_minor_units, currency, currency_scale, units, source,
                    recorded_at, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                )
                .bind(
                  costId,
                  input.shopId,
                  input.intentId,
                  input.attemptId,
                  input.environment,
                  input.provider,
                  input.providerAccountKey,
                  input.billingIdentityFingerprint,
                  input.unitOrdinal,
                  input.amountMinorUnits,
                  input.currency,
                  input.currencyScale,
                  input.units,
                  input.source,
                  input.recordedAt,
                  input.recordedAt
                )
                .run()
            )
            const storedRow = yield* selectCost()
            if (!storedRow)
              return yield* unavailable('provider cost missing after commit')
            const stored = providerCostFromRow(storedRow)
            if (
              stored.shopId !== input.shopId ||
              stored.intentId !== input.intentId ||
              stored.attemptId !== input.attemptId ||
              stored.amountMinorUnits !== input.amountMinorUnits ||
              stored.currency !== input.currency ||
              stored.currencyScale !== input.currencyScale ||
              stored.units !== input.units ||
              stored.source !== input.source
            )
              return yield* new MessagingFinanceRejected({
                operation: 'record_provider_cost',
                reason: 'idempotency_conflict',
                shopId: input.shopId,
                resourceId: stored.id
              })
            return stored
          }),
        recordExternalFact: (input) =>
          Effect.gen(function* () {
            const selectFact = () =>
              first<ExternalFactRow>(
                raw,
                `SELECT * FROM messaging_financial_external_facts
                 WHERE kind = ? AND provider = ? AND source_id = ? AND status = ?`,
                input.kind,
                input.provider,
                input.sourceId,
                input.status
              )
            const existingRow = yield* selectFact()
            if (existingRow) {
              const existing = externalFactFromRow(existingRow)
              if (
                existing.shopId !== input.shopId ||
                existing.amountMilliEuro !== input.amountMilliEuro ||
                existing.currency !== input.currency ||
                existing.reference !== input.reference ||
                existing.relatedSourceId !== input.relatedSourceId
              )
                return yield* new MessagingFinanceRejected({
                  operation: 'record_external_fact',
                  reason: 'idempotency_conflict',
                  shopId: input.shopId,
                  resourceId: existing.id
                })
              return existing
            }
            yield* tryDb(() =>
              raw
                .prepare(
                  `INSERT OR IGNORE INTO messaging_financial_external_facts
                   (id, shop_id, kind, provider, source_id, status, amount_milli_euro,
                    currency, reference, related_source_id, observed_at, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                )
                .bind(
                  id('mff'),
                  input.shopId,
                  input.kind,
                  input.provider,
                  input.sourceId,
                  input.status,
                  input.amountMilliEuro ?? null,
                  input.currency,
                  input.reference ?? null,
                  input.relatedSourceId ?? null,
                  input.observedAt,
                  input.observedAt
                )
                .run()
            )
            const storedRow = yield* selectFact()
            if (!storedRow)
              return yield* unavailable('external financial fact missing after commit')
            const stored = externalFactFromRow(storedRow)
            if (
              stored.shopId !== input.shopId ||
              stored.amountMilliEuro !== input.amountMilliEuro ||
              stored.currency !== input.currency ||
              stored.reference !== input.reference ||
              stored.relatedSourceId !== input.relatedSourceId
            )
              return yield* new MessagingFinanceRejected({
                operation: 'record_external_fact',
                reason: 'idempotency_conflict',
                shopId: input.shopId,
                resourceId: stored.id
              })
            return stored
          }),
        reconciliationInputs: readReconciliation,
        operationsProjection: (input) =>
          Effect.gen(function* () {
            const [reconciliation, rateCardRows] = yield* Effect.all([
              readReconciliation(input.shopId),
              all<RateCardRow>(
                raw,
                `SELECT id, version, currency, charge_milli_euro, effective_at,
                  notice_published_at, retired_at
                 FROM messaging_rate_cards ORDER BY version`
              )
            ])
            return {
              rateCards: rateCardRows.map(rateCardFromRow),
              reconciliation: operationsReconciliation(reconciliation),
              margin: deriveMarginProjection(
                reconciliation,
                thirtyDaysBefore(input.asOf),
                input.expectedRouteCosts
              )
            }
          })
      }
      return service
    })
  )
