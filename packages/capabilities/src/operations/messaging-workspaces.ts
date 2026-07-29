import { Context, Effect, Layer, Schema } from 'effect'
import { asc, eq, or, sql } from 'drizzle-orm'
import { layerFromD1, type PromiseDrizzleDatabase } from '@b2b-saas-starter/db'
import {
  LiveMessagingFinance,
  MessagingFinance,
  MessagingFinanceRejected
} from '../notifications/messaging-finance.ts'
import {
  chargeableDeliveries,
  deliveryRoutes,
  merchantMessagingBalanceSummaries,
  merchants,
  messagingBalanceReservations,
  messagingBalanceLedgerEntries,
  messagingChannelControls,
  messagingIncidents,
  messagingRateCards,
  messagingReconciliationCases,
  messagingReconciliationResolutions,
  notificationIntents,
  protectedMessagingDestinations,
  providerEvidence,
  providerMessagingCosts,
  shops,
  submissionAttempts
} from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import {
  hasOperatorPermission,
  makeOperationsAuthorizationLayer,
  OperationsAuthorization,
  type OperatorPermission,
  type OperatorPrincipal,
  type OperatorSessionReference
} from './operations-contracts.ts'

const Purpose = Schema.Literals([
  'appointment_confirmation',
  'appointment_reminder',
  'appointment_cancellation',
  'appointment_reschedule'
])
const Severity = Schema.Literals(['low', 'medium', 'high', 'critical'])
const CaseStatus = Schema.Literals(['open', 'investigating', 'resolved', 'waived'])

export const MessagingHealthSummary = Schema.Struct({
  openCaseCount: Schema.Int,
  ambiguousCount: Schema.Int,
  complaintCount: Schema.Int,
  deliveredRouteCount: Schema.Int,
  merchantChargeMilliEuro: Schema.Int,
  providerCostCount: Schema.Int,
  providerCostMilliEuro: Schema.Number
})

export const MessagingCaseQueueItem = Schema.Struct({
  caseId: Schema.String,
  shopId: Schema.optional(Schema.String),
  merchantId: Schema.optional(Schema.String),
  merchantName: Schema.optional(Schema.String),
  intentId: Schema.optional(Schema.String),
  purpose: Schema.optional(Purpose),
  maskedDestination: Schema.optional(Schema.String),
  kind: Schema.String,
  status: CaseStatus,
  severity: Severity,
  safeSummary: Schema.String,
  openedAt: Schema.String
})

export const MessagingWorkspaceOverview = Schema.Struct({
  health: MessagingHealthSummary,
  cases: Schema.Array(MessagingCaseQueueItem)
})

export const MessagingAttemptSummary = Schema.Struct({
  attemptId: Schema.String,
  routeId: Schema.String,
  ordinal: Schema.Int,
  state: Schema.Literals([
    'prepared',
    'submitting',
    'captured',
    'accepted',
    'rejected_retryable',
    'rejected_terminal',
    'submission_unknown'
  ]),
  startedAt: Schema.String,
  completedAt: Schema.optional(Schema.String)
})

export const MessagingEvidenceSummary = Schema.Struct({
  evidenceId: Schema.String,
  attemptId: Schema.String,
  routeId: Schema.String,
  provider: Schema.Literals(['meta', 'smso']),
  source: Schema.Literals(['response', 'callback', 'query', 'operator']),
  status: Schema.Literals([
    'captured',
    'accepted',
    'rejected_retryable',
    'rejected_terminal',
    'submission_unknown',
    'delivered',
    'read',
    'terminal_failure'
  ]),
  trusted: Schema.Boolean,
  normalizedCode: Schema.optional(Schema.String),
  providerOccurredAt: Schema.optional(Schema.String),
  observedAt: Schema.String
})

export const MessagingRouteJourneyItem = Schema.Struct({
  routeId: Schema.String,
  ordinal: Schema.Int,
  channel: Schema.Literals(['whatsapp', 'sms']),
  provider: Schema.Literals(['meta', 'smso']),
  state: Schema.String,
  ineligibleReason: Schema.optional(Schema.String),
  acceptedAt: Schema.optional(Schema.String),
  deliveredAt: Schema.optional(Schema.String),
  terminalAt: Schema.optional(Schema.String)
})

export const MessagingCaseDetail = Schema.Struct({
  case: MessagingCaseQueueItem,
  intent: Schema.Struct({
    intentId: Schema.String,
    sourceType: Schema.String,
    sourceId: Schema.String,
    sourceVersion: Schema.optional(Schema.Int),
    purpose: Schema.optional(Purpose),
    phase: Schema.optional(Schema.String),
    result: Schema.optional(Schema.String),
    maskedDestination: Schema.optional(Schema.String),
    availableAt: Schema.String,
    terminalAt: Schema.optional(Schema.String)
  }),
  routes: Schema.Array(MessagingRouteJourneyItem),
  attempts: Schema.Array(MessagingAttemptSummary),
  evidence: Schema.Array(MessagingEvidenceSummary),
  reservation: Schema.optional(
    Schema.Struct({
      reservationId: Schema.String,
      rateCardId: Schema.String,
      amountMilliEuro: Schema.Int,
      status: Schema.Literals(['active', 'converted', 'released']),
      expiresAt: Schema.String
    })
  ),
  charges: Schema.Array(
    Schema.Struct({
      chargeId: Schema.String,
      routeId: Schema.String,
      chargeMilliEuro: Schema.Int,
      verifiedAt: Schema.String
    })
  ),
  providerCosts: Schema.Array(
    Schema.Struct({
      costId: Schema.String,
      attemptId: Schema.String,
      provider: Schema.Literals(['meta', 'smso']),
      amountMinorUnits: Schema.Int,
      currency: Schema.String,
      currencyScale: Schema.Int,
      units: Schema.Int,
      source: Schema.Literals(['response', 'callback', 'query', 'invoice']),
      recordedAt: Schema.String
    })
  ),
  reconciliation: Schema.Struct({
    status: CaseStatus,
    resolutions: Schema.Array(
      Schema.Struct({
        disposition: Schema.Literals(['resolved', 'waived']),
        classification: Schema.String,
        source: Schema.String,
        reason: Schema.String,
        createdAt: Schema.String
      })
    )
  }),
  complaints: Schema.Array(MessagingCaseQueueItem)
})

export const MessagingContainmentWorkspace = Schema.Struct({
  controls: Schema.Array(
    Schema.Struct({
      controlId: Schema.String,
      environment: Schema.String,
      channel: Schema.Literals(['whatsapp', 'sms']),
      provider: Schema.Literals(['meta', 'smso']),
      enabled: Schema.Boolean,
      reason: Schema.optional(Schema.String),
      updatedAt: Schema.String
    })
  )
})

export const MessagingFinanceWorkspace = Schema.Struct({
  rateCards: Schema.Array(
    Schema.Struct({
      rateCardId: Schema.String,
      version: Schema.Int,
      currency: Schema.String,
      chargeMilliEuro: Schema.Int,
      effectiveAt: Schema.String,
      retiredAt: Schema.optional(Schema.String)
    })
  ),
  balances: Schema.Array(
    Schema.Struct({
      shopId: Schema.String,
      merchantId: Schema.String,
      merchantName: Schema.String,
      currency: Schema.String,
      postedMilliEuro: Schema.Int,
      reservedMilliEuro: Schema.Int,
      availableMilliEuro: Schema.Int,
      financiallyFrozen: Schema.Boolean
    })
  ),
  charges: Schema.Array(
    Schema.Struct({
      chargeId: Schema.String,
      shopId: Schema.String,
      intentId: Schema.String,
      chargeMilliEuro: Schema.Int,
      verifiedAt: Schema.String
    })
  ),
  providerCosts: Schema.Array(
    Schema.Struct({
      costId: Schema.String,
      shopId: Schema.String,
      intentId: Schema.String,
      provider: Schema.Literals(['meta', 'smso']),
      amountMinorUnits: Schema.Int,
      currency: Schema.String,
      currencyScale: Schema.Int,
      units: Schema.Int,
      source: Schema.Literals(['response', 'callback', 'query', 'invoice']),
      recordedAt: Schema.String
    })
  ),
  ledgerEntries: Schema.Array(
    Schema.Struct({
      entryId: Schema.String,
      shopId: Schema.String,
      direction: Schema.Literals(['credit', 'debit']),
      kind: Schema.Literals([
        'top_up',
        'delivery_charge',
        'operator_adjustment',
        'refund',
        'correction',
        'promotional_credit'
      ]),
      amountMilliEuro: Schema.Int,
      currency: Schema.String,
      occurredAt: Schema.String,
      reversed: Schema.Boolean
    })
  )
})

export const MessagingReconciliationWorkspace = Schema.Struct({
  cases: Schema.Array(MessagingCaseQueueItem)
})

export const MessagingIncidentWorkspace = Schema.Struct({
  incidents: Schema.Array(
    Schema.Struct({
      incidentId: Schema.String,
      shopId: Schema.optional(Schema.String),
      provider: Schema.optional(Schema.Literals(['meta', 'smso'])),
      channel: Schema.optional(Schema.Literals(['whatsapp', 'sms'])),
      kind: Schema.String,
      status: Schema.Literals(['open', 'contained', 'recovering', 'resolved']),
      severity: Severity,
      safeSummary: Schema.String,
      containmentScope: Schema.Literals([
        'merchant',
        'provider_channel',
        'callback_rule',
        'global'
      ]),
      openedAt: Schema.String,
      resolvedAt: Schema.optional(Schema.String)
    })
  )
})

export class MessagingWorkspacesDenied extends Schema.TaggedErrorClass<MessagingWorkspacesDenied>()(
  'MessagingWorkspacesDenied',
  { operation: Schema.String, reason: Schema.String }
) {}

type WorkspaceError = MessagingWorkspacesDenied | CapabilityUnavailable
type Overview = typeof MessagingWorkspaceOverview.Type
type CaseDetail = typeof MessagingCaseDetail.Type
type ChannelControl = (typeof MessagingContainmentWorkspace.Type.controls)[number]
type FinanceWorkspace = typeof MessagingFinanceWorkspace.Type
type ReconciliationItem = typeof MessagingCaseQueueItem.Type
type IncidentItem = (typeof MessagingIncidentWorkspace.Type.incidents)[number]

export type MessagingWorkspacesShape = {
  readonly overview: (input: {
    readonly actor: OperatorSessionReference
    readonly query?: string
  }) => Effect.Effect<Overview, WorkspaceError>
  readonly caseDetail: (input: {
    readonly actor: OperatorSessionReference
    readonly caseId: string
  }) => Effect.Effect<CaseDetail, WorkspaceError>
  readonly containment: (
    actor: OperatorSessionReference
  ) => Effect.Effect<readonly ChannelControl[], WorkspaceError>
  readonly finance: (
    actor: OperatorSessionReference
  ) => Effect.Effect<FinanceWorkspace, WorkspaceError>
  readonly reconciliation: (
    actor: OperatorSessionReference
  ) => Effect.Effect<readonly ReconciliationItem[], WorkspaceError>
  readonly incidents: (
    actor: OperatorSessionReference
  ) => Effect.Effect<readonly IncidentItem[], WorkspaceError>
  readonly correctLedgerEntry: (input: {
    readonly actor: OperatorSessionReference
    readonly shopId: string
    readonly entryId: string
    readonly correctionReason: string
    readonly reason: string
    readonly confirmed: boolean
  }) => Effect.Effect<void, WorkspaceError>
}

export class MessagingWorkspaces extends Context.Service<
  MessagingWorkspaces,
  MessagingWorkspacesShape
>()('@b2b-saas-starter/capabilities/operations/MessagingWorkspaces') {}

const denied = (operation: string, reason: string) =>
  new MessagingWorkspacesDenied({ operation, reason })

const optional = <K extends string, V>(key: K, value: V | null | undefined) =>
  value == null ? {} : ({ [key]: value } as { readonly [P in K]: V })

const authorize = async (
  db: PromiseDrizzleDatabase,
  actor: OperatorSessionReference,
  permission: OperatorPermission,
  operation: string,
  now: Date
): Promise<OperatorPrincipal> => {
  let principal: OperatorPrincipal
  try {
    principal = await Effect.runPromise(
      Effect.flatMap(OperationsAuthorization, (authorization) =>
        authorization.authorize(actor, now)
      ).pipe(Effect.provide(makeOperationsAuthorizationLayer(db)))
    )
  } catch {
    throw denied(operation, 'operator_session_not_authorized')
  }
  if (!hasOperatorPermission(principal.roles, permission))
    throw denied(operation, `${permission}_required`)
  return principal
}

const wrap = <A>(operation: string, work: () => Promise<A>) =>
  Effect.tryPromise({
    try: work,
    catch: (error) =>
      error instanceof MessagingWorkspacesDenied
        ? error
        : new CapabilityUnavailable({
            capability: 'operations-messaging-workspaces',
            reason: error instanceof Error ? error.message : String(error)
          })
  })

type QueueRow = {
  readonly caseId: string
  readonly shopId: string | null
  readonly merchantId: string | null
  readonly merchantName: string | null
  readonly merchantSlug: string | null
  readonly intentId: string | null
  readonly purpose: typeof Purpose.Type | null
  readonly maskedDestination: string | null
  readonly kind: string
  readonly status: typeof CaseStatus.Type
  readonly severity: typeof Severity.Type
  readonly safeSummary: string
  readonly openedAt: string
}

const queueItem = (row: QueueRow): ReconciliationItem => ({
  caseId: row.caseId,
  ...optional('shopId', row.shopId),
  ...optional('merchantId', row.merchantId),
  ...optional('merchantName', row.merchantName),
  ...optional('intentId', row.intentId),
  ...optional('purpose', row.purpose),
  ...optional('maskedDestination', row.maskedDestination),
  kind: row.kind,
  status: row.status,
  severity: row.severity,
  safeSummary: row.safeSummary,
  openedAt: row.openedAt
})

export const makeMessagingWorkspacesLayer = (
  db: PromiseDrizzleDatabase,
  options: { readonly now?: () => Date } = {}
): Layer.Layer<MessagingWorkspaces> => {
  const currentTime = options.now ?? (() => new Date())

  const loadQueue = async (input?: {
    readonly query?: string
    readonly caseId?: string
  }): Promise<readonly QueueRow[]> => {
    const base = db
      .select({
        caseId: messagingReconciliationCases.id,
        shopId: messagingReconciliationCases.shopId,
        merchantId: merchants.id,
        merchantName: merchants.publicName,
        merchantSlug: merchants.slug,
        intentId: messagingReconciliationCases.intentId,
        purpose: notificationIntents.purpose,
        maskedDestination: protectedMessagingDestinations.maskedValue,
        kind: messagingReconciliationCases.kind,
        status: messagingReconciliationCases.status,
        severity: messagingReconciliationCases.severity,
        safeSummary: messagingReconciliationCases.safeSummary,
        openedAt: messagingReconciliationCases.openedAt
      })
      .from(messagingReconciliationCases)
      .leftJoin(shops, eq(shops.id, messagingReconciliationCases.shopId))
      .leftJoin(merchants, eq(merchants.id, shops.merchantId))
      .leftJoin(
        notificationIntents,
        eq(notificationIntents.id, messagingReconciliationCases.intentId)
      )
      .leftJoin(
        protectedMessagingDestinations,
        eq(protectedMessagingDestinations.intentId, notificationIntents.id)
      )
      .orderBy(
        asc(messagingReconciliationCases.openedAt),
        asc(messagingReconciliationCases.id)
      )
      .$dynamic()
    if (input?.caseId)
      return base.where(eq(messagingReconciliationCases.id, input.caseId)).limit(1)
    const term = input?.query?.trim()
    if (!term) return base.limit(100)
    const normalized = `%${term.toLocaleLowerCase('en').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
    const destination = /^\d{3}$/.test(term)
      ? sql<boolean>`${protectedMessagingDestinations.maskedValue} LIKE ${`%${term}`}`
      : sql<boolean>`false`
    return base
      .where(
        or(
          eq(notificationIntents.id, term),
          eq(merchants.id, term),
          sql<boolean>`lower(${merchants.publicName}) LIKE ${normalized} ESCAPE '\\'`,
          sql<boolean>`lower(${merchants.slug}) LIKE ${normalized} ESCAPE '\\'`,
          destination,
          sql<boolean>`EXISTS (
            SELECT 1 FROM submission_attempts AS matched_attempt
            WHERE matched_attempt.intent_id = ${messagingReconciliationCases.intentId}
              AND matched_attempt.id = ${term}
          )`
        )
      )
      .limit(100)
  }

  return Layer.succeed(MessagingWorkspaces)({
    overview: ({ actor, query }) =>
      wrap('messaging-overview', async () => {
        await authorize(
          db,
          actor,
          'messaging:read',
          'messaging-overview',
          currentTime()
        )
        const [rows, caseHealth, routes, charges, costs] = await Promise.all([
          loadQueue(query === undefined ? undefined : { query }),
          db
            .select({
              openCaseCount: sql<number>`sum(case when ${messagingReconciliationCases.status} in ('open', 'investigating') then 1 else 0 end)`,
              ambiguousCount: sql<number>`sum(case when lower(${messagingReconciliationCases.kind}) like '%ambigu%' then 1 else 0 end)`,
              complaintCount: sql<number>`sum(case when lower(${messagingReconciliationCases.kind}) like '%complaint%' then 1 else 0 end)`
            })
            .from(messagingReconciliationCases),
          db
            .select({ count: sql<number>`count(*)` })
            .from(deliveryRoutes)
            .where(eq(deliveryRoutes.state, 'delivered')),
          db
            .select({
              total: sql<number>`coalesce(sum(${chargeableDeliveries.chargeMilliEuro}), 0)`
            })
            .from(chargeableDeliveries),
          db
            .select({
              count: sql<number>`count(*)`,
              euroMilli: sql<number>`coalesce(sum(case
                when ${providerMessagingCosts.currency} <> 'EUR' then 0
                when ${providerMessagingCosts.currencyScale} = 0 then ${providerMessagingCosts.amountMinorUnits} * 1000.0
                when ${providerMessagingCosts.currencyScale} = 1 then ${providerMessagingCosts.amountMinorUnits} * 100.0
                when ${providerMessagingCosts.currencyScale} = 2 then ${providerMessagingCosts.amountMinorUnits} * 10.0
                when ${providerMessagingCosts.currencyScale} = 3 then ${providerMessagingCosts.amountMinorUnits} * 1.0
                when ${providerMessagingCosts.currencyScale} = 4 then ${providerMessagingCosts.amountMinorUnits} / 10.0
                when ${providerMessagingCosts.currencyScale} = 5 then ${providerMessagingCosts.amountMinorUnits} / 100.0
                when ${providerMessagingCosts.currencyScale} = 6 then ${providerMessagingCosts.amountMinorUnits} / 1000.0
                when ${providerMessagingCosts.currencyScale} = 7 then ${providerMessagingCosts.amountMinorUnits} / 10000.0
                when ${providerMessagingCosts.currencyScale} = 8 then ${providerMessagingCosts.amountMinorUnits} / 100000.0
                else ${providerMessagingCosts.amountMinorUnits} / 1000000.0 end), 0)`
            })
            .from(providerMessagingCosts)
        ])
        const health = caseHealth[0]
        return {
          health: {
            openCaseCount: health?.openCaseCount ?? 0,
            ambiguousCount: health?.ambiguousCount ?? 0,
            complaintCount: health?.complaintCount ?? 0,
            deliveredRouteCount: routes[0]?.count ?? 0,
            merchantChargeMilliEuro: charges[0]?.total ?? 0,
            providerCostCount: costs[0]?.count ?? 0,
            providerCostMilliEuro: costs[0]?.euroMilli ?? 0
          },
          cases: rows.map(queueItem)
        }
      }),

    caseDetail: ({ actor, caseId }) =>
      wrap('messaging-case-detail', async () => {
        await authorize(
          db,
          actor,
          'messaging:read',
          'messaging-case-detail',
          currentTime()
        )
        const rows = await loadQueue({ caseId })
        const row = rows.find((candidate) => candidate.caseId === caseId)
        if (!row?.intentId) throw denied('messaging-case-detail', 'case_not_found')
        const [
          intentRows,
          routeRows,
          attemptRows,
          evidenceRows,
          reservationRows,
          chargeRows,
          costRows,
          resolutionRows,
          complaintRows
        ] = await Promise.all([
          db
            .select({
              intentId: notificationIntents.id,
              sourceType: notificationIntents.sourceType,
              sourceId: notificationIntents.sourceId,
              sourceVersion: notificationIntents.sourceVersion,
              purpose: notificationIntents.purpose,
              phase: notificationIntents.phase,
              result: notificationIntents.result,
              availableAt: notificationIntents.availableAt,
              terminalAt: notificationIntents.terminalAt,
              maskedDestination: protectedMessagingDestinations.maskedValue
            })
            .from(notificationIntents)
            .leftJoin(
              protectedMessagingDestinations,
              eq(protectedMessagingDestinations.intentId, notificationIntents.id)
            )
            .where(eq(notificationIntents.id, row.intentId))
            .limit(1),
          db
            .select()
            .from(deliveryRoutes)
            .where(eq(deliveryRoutes.intentId, row.intentId))
            .orderBy(asc(deliveryRoutes.ordinal)),
          db
            .select()
            .from(submissionAttempts)
            .where(eq(submissionAttempts.intentId, row.intentId))
            .orderBy(asc(submissionAttempts.startedAt), asc(submissionAttempts.id)),
          db
            .select()
            .from(providerEvidence)
            .where(eq(providerEvidence.intentId, row.intentId))
            .orderBy(asc(providerEvidence.observedAt), asc(providerEvidence.id)),
          db
            .select()
            .from(messagingBalanceReservations)
            .where(eq(messagingBalanceReservations.intentId, row.intentId))
            .limit(1),
          db
            .select()
            .from(chargeableDeliveries)
            .where(eq(chargeableDeliveries.intentId, row.intentId)),
          db
            .select()
            .from(providerMessagingCosts)
            .where(eq(providerMessagingCosts.intentId, row.intentId)),
          db
            .select({
              disposition: messagingReconciliationResolutions.disposition,
              classification: messagingReconciliationResolutions.classification,
              source: messagingReconciliationResolutions.source,
              reason: messagingReconciliationResolutions.reason,
              createdAt: messagingReconciliationResolutions.createdAt
            })
            .from(messagingReconciliationResolutions)
            .where(eq(messagingReconciliationResolutions.caseId, caseId))
            .orderBy(asc(messagingReconciliationResolutions.createdAt)),
          db
            .select({
              caseId: messagingReconciliationCases.id,
              shopId: messagingReconciliationCases.shopId,
              merchantId: merchants.id,
              merchantName: merchants.publicName,
              merchantSlug: merchants.slug,
              intentId: messagingReconciliationCases.intentId,
              purpose: notificationIntents.purpose,
              maskedDestination: protectedMessagingDestinations.maskedValue,
              kind: messagingReconciliationCases.kind,
              status: messagingReconciliationCases.status,
              severity: messagingReconciliationCases.severity,
              safeSummary: messagingReconciliationCases.safeSummary,
              openedAt: messagingReconciliationCases.openedAt
            })
            .from(messagingReconciliationCases)
            .leftJoin(shops, eq(shops.id, messagingReconciliationCases.shopId))
            .leftJoin(merchants, eq(merchants.id, shops.merchantId))
            .leftJoin(
              notificationIntents,
              eq(notificationIntents.id, messagingReconciliationCases.intentId)
            )
            .leftJoin(
              protectedMessagingDestinations,
              eq(protectedMessagingDestinations.intentId, notificationIntents.id)
            )
            .where(
              sql`${messagingReconciliationCases.intentId} = ${row.intentId}
                AND lower(${messagingReconciliationCases.kind}) LIKE '%complaint%'`
            )
        ])
        const intent = intentRows[0]
        if (!intent) throw denied('messaging-case-detail', 'case_not_found')
        const reservation = reservationRows[0]
        return {
          case: queueItem(row),
          intent: {
            intentId: intent.intentId,
            sourceType: intent.sourceType,
            sourceId: intent.sourceId,
            ...optional('sourceVersion', intent.sourceVersion),
            ...optional('purpose', intent.purpose),
            ...optional('phase', intent.phase),
            ...optional('result', intent.result),
            ...optional('maskedDestination', intent.maskedDestination),
            availableAt: intent.availableAt,
            ...optional('terminalAt', intent.terminalAt)
          },
          routes: routeRows.map((route) => ({
            routeId: route.id,
            ordinal: route.ordinal,
            channel: route.channel,
            provider: route.provider,
            state: route.state,
            ...optional('ineligibleReason', route.ineligibleReason),
            ...optional('acceptedAt', route.acceptedAt),
            ...optional('deliveredAt', route.deliveredAt),
            ...optional('terminalAt', route.terminalAt)
          })),
          attempts: attemptRows.map((attempt) => ({
            attemptId: attempt.id,
            routeId: attempt.routeId,
            ordinal: attempt.ordinal,
            state: attempt.state,
            startedAt: attempt.startedAt,
            ...optional('completedAt', attempt.completedAt)
          })),
          evidence: evidenceRows.map((evidence) => ({
            evidenceId: evidence.id,
            attemptId: evidence.attemptId,
            routeId: evidence.routeId,
            provider: evidence.provider,
            source: evidence.source,
            status: evidence.status,
            trusted: evidence.trusted,
            ...optional('normalizedCode', evidence.normalizedCode),
            ...optional('providerOccurredAt', evidence.providerOccurredAt),
            observedAt: evidence.observedAt
          })),
          ...(reservation
            ? {
                reservation: {
                  reservationId: reservation.id,
                  rateCardId: reservation.rateCardId,
                  amountMilliEuro: reservation.amountMilliEuro,
                  status: reservation.status,
                  expiresAt: reservation.expiresAt
                }
              }
            : {}),
          charges: chargeRows.map((charge) => ({
            chargeId: charge.id,
            routeId: charge.routeId,
            chargeMilliEuro: charge.chargeMilliEuro,
            verifiedAt: charge.verifiedAt
          })),
          providerCosts: costRows.map((cost) => ({
            costId: cost.id,
            attemptId: cost.attemptId,
            provider: cost.provider,
            amountMinorUnits: cost.amountMinorUnits,
            currency: cost.currency,
            currencyScale: cost.currencyScale,
            units: cost.units,
            source: cost.source,
            recordedAt: cost.recordedAt
          })),
          reconciliation: {
            status: row.status,
            resolutions: resolutionRows
          },
          complaints: complaintRows.map(queueItem)
        }
      }),

    containment: (actor) =>
      wrap('messaging-containment', async () => {
        await authorize(
          db,
          actor,
          'messaging:control',
          'messaging-containment',
          currentTime()
        )
        const rows = await db
          .select()
          .from(messagingChannelControls)
          .orderBy(
            asc(messagingChannelControls.environment),
            asc(messagingChannelControls.channel)
          )
        return rows.map((row) => ({
          controlId: row.id,
          environment: row.environment,
          channel: row.channel,
          provider: row.provider,
          enabled: row.enabled,
          ...optional('reason', row.reason),
          updatedAt: row.updatedAt
        }))
      }),

    finance: (actor) =>
      wrap('messaging-finance', async () => {
        await authorize(
          db,
          actor,
          'messaging:finance',
          'messaging-finance',
          currentTime()
        )
        const [rows, balances, charges, costs, ledger] = await Promise.all([
          db.select().from(messagingRateCards).orderBy(asc(messagingRateCards.version)),
          db
            .select({
              shopId: merchantMessagingBalanceSummaries.shopId,
              merchantId: merchants.id,
              merchantName: merchants.publicName,
              currency: merchantMessagingBalanceSummaries.currency,
              postedMilliEuro: merchantMessagingBalanceSummaries.postedMilliEuro,
              reservedMilliEuro: merchantMessagingBalanceSummaries.reservedMilliEuro,
              availableMilliEuro: merchantMessagingBalanceSummaries.availableMilliEuro,
              financiallyFrozen: merchantMessagingBalanceSummaries.financiallyFrozen
            })
            .from(merchantMessagingBalanceSummaries)
            .innerJoin(shops, eq(shops.id, merchantMessagingBalanceSummaries.shopId))
            .innerJoin(merchants, eq(merchants.id, shops.merchantId))
            .orderBy(asc(merchants.publicName), asc(shops.id)),
          db
            .select({
              chargeId: chargeableDeliveries.id,
              shopId: chargeableDeliveries.shopId,
              intentId: chargeableDeliveries.intentId,
              chargeMilliEuro: chargeableDeliveries.chargeMilliEuro,
              verifiedAt: chargeableDeliveries.verifiedAt
            })
            .from(chargeableDeliveries)
            .orderBy(asc(chargeableDeliveries.verifiedAt)),
          db
            .select({
              costId: providerMessagingCosts.id,
              shopId: providerMessagingCosts.shopId,
              intentId: providerMessagingCosts.intentId,
              provider: providerMessagingCosts.provider,
              amountMinorUnits: providerMessagingCosts.amountMinorUnits,
              currency: providerMessagingCosts.currency,
              currencyScale: providerMessagingCosts.currencyScale,
              units: providerMessagingCosts.units,
              source: providerMessagingCosts.source,
              recordedAt: providerMessagingCosts.recordedAt
            })
            .from(providerMessagingCosts)
            .orderBy(asc(providerMessagingCosts.recordedAt)),
          db
            .select({
              entryId: messagingBalanceLedgerEntries.id,
              shopId: messagingBalanceLedgerEntries.shopId,
              direction: messagingBalanceLedgerEntries.direction,
              kind: messagingBalanceLedgerEntries.kind,
              amountMilliEuro: messagingBalanceLedgerEntries.amountMilliEuro,
              currency: messagingBalanceLedgerEntries.currency,
              occurredAt: messagingBalanceLedgerEntries.occurredAt,
              reversesEntryId: messagingBalanceLedgerEntries.reversesEntryId
            })
            .from(messagingBalanceLedgerEntries)
            .orderBy(asc(messagingBalanceLedgerEntries.occurredAt))
        ])
        const reversedEntries = new Set(
          ledger.flatMap((entry) =>
            entry.reversesEntryId ? [entry.reversesEntryId] : []
          )
        )
        return {
          rateCards: rows.map((row) => ({
            rateCardId: row.id,
            version: row.version,
            currency: row.currency,
            chargeMilliEuro: row.chargeMilliEuro,
            effectiveAt: row.effectiveAt,
            ...optional('retiredAt', row.retiredAt)
          })),
          balances,
          charges,
          providerCosts: costs,
          ledgerEntries: ledger.map(({ reversesEntryId: _, ...entry }) => ({
            ...entry,
            reversed: reversedEntries.has(entry.entryId)
          }))
        }
      }),

    reconciliation: (actor) =>
      wrap('messaging-reconciliation', async () => {
        await authorize(
          db,
          actor,
          'messaging:reconcile',
          'messaging-reconciliation',
          currentTime()
        )
        return (await loadQueue()).map(queueItem)
      }),

    incidents: (actor) =>
      wrap('messaging-incidents', async () => {
        await authorize(
          db,
          actor,
          'messaging:incident',
          'messaging-incidents',
          currentTime()
        )
        const rows = await db
          .select()
          .from(messagingIncidents)
          .orderBy(asc(messagingIncidents.openedAt), asc(messagingIncidents.id))
        return rows.map((row) => ({
          incidentId: row.id,
          ...optional('shopId', row.shopId),
          ...optional('provider', row.provider),
          ...optional('channel', row.channel),
          kind: row.kind,
          status: row.status,
          severity: row.severity,
          safeSummary: row.safeSummary,
          containmentScope: row.containmentScope,
          openedAt: row.openedAt,
          ...optional('resolvedAt', row.resolvedAt)
        }))
      }),

    correctLedgerEntry: (input) =>
      wrap('messaging-finance-correction', async () => {
        if (!input.confirmed)
          throw denied('messaging-finance-correction', 'confirmation_required')
        if (input.reason.trim().length < 12 || !input.correctionReason.trim())
          throw denied('messaging-finance-correction', 'substantive_reason_required')
        const principal = await authorize(
          db,
          input.actor,
          'messaging:finance',
          'messaging-finance-correction',
          currentTime()
        )
        try {
          await Effect.runPromise(
            Effect.flatMap(MessagingFinance, (finance) =>
              finance.correct({
                shopId: input.shopId,
                entryId: input.entryId,
                correctionReason: input.correctionReason.trim(),
                sourceType: 'operations_messaging_case',
                sourceId: input.entryId,
                idempotencyKey: `operations-correction:${input.entryId}:${input.correctionReason.trim()}`,
                actorType: 'system_operator',
                actorId: principal.id,
                operatorPrincipal: principal,
                reason: input.reason.trim(),
                occurredAt: currentTime().toISOString()
              })
            ).pipe(
              Effect.provide(LiveMessagingFinance),
              Effect.provide(
                layerFromD1(db.$client as Parameters<typeof layerFromD1>[0])
              )
            )
          )
        } catch (error) {
          if (error instanceof MessagingFinanceRejected)
            throw denied('messaging-finance-correction', error.reason)
          throw error
        }
      })
  })
}
