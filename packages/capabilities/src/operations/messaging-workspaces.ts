import { Context, Effect, Layer, Schema } from 'effect'
import { asc, eq } from 'drizzle-orm'
import type { PromiseDrizzleDatabase } from '@b2b-saas-starter/db'
import {
  chargeableDeliveries,
  deliveryRoutes,
  merchantMessagingBalanceSummaries,
  merchants,
  messagingBalanceReservations,
  messagingChannelControls,
  messagingIncidents,
  messagingRateCards,
  messagingReconciliationCases,
  notificationIntents,
  protectedMessagingDestinations,
  providerEvidence,
  providerMessagingCosts,
  shops,
  submissionAttempts
} from '@b2b-saas-starter/db'
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
  providerCostCount: Schema.Int
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
  )
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

type WorkspaceError = MessagingWorkspacesDenied
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
        : denied(operation, 'workspace_unavailable')
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

  const loadQueue = async (): Promise<readonly QueueRow[]> =>
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
      .orderBy(
        asc(messagingReconciliationCases.openedAt),
        asc(messagingReconciliationCases.id)
      )
      .limit(500)

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
        const [rows, routes, charges, costs, matchingAttempts] = await Promise.all([
          loadQueue(),
          db.select({ state: deliveryRoutes.state }).from(deliveryRoutes),
          db
            .select({ chargeMilliEuro: chargeableDeliveries.chargeMilliEuro })
            .from(chargeableDeliveries),
          db.select({ id: providerMessagingCosts.id }).from(providerMessagingCosts),
          query?.trim()
            ? db
                .select({ intentId: submissionAttempts.intentId })
                .from(submissionAttempts)
                .where(eq(submissionAttempts.id, query.trim()))
            : Promise.resolve([])
        ])
        const term = query?.trim() ?? ''
        const normalized = term.toLocaleLowerCase('en')
        const destinationDigits = /^\d{3}$/.test(term) ? term : undefined
        const attemptIntentIds = new Set(matchingAttempts.map((row) => row.intentId))
        const filtered = term
          ? rows.filter(
              (row) =>
                row.caseId === term ||
                row.intentId === term ||
                row.shopId === term ||
                row.merchantId === term ||
                row.merchantName?.toLocaleLowerCase('en').includes(normalized) ||
                row.merchantSlug?.toLocaleLowerCase('en').includes(normalized) ||
                (destinationDigits
                  ? row.maskedDestination?.endsWith(destinationDigits)
                  : false) ||
                (row.intentId ? attemptIntentIds.has(row.intentId) : false)
            )
          : rows
        return {
          health: {
            openCaseCount: rows.filter(
              (row) => row.status === 'open' || row.status === 'investigating'
            ).length,
            ambiguousCount: rows.filter((row) => /ambigu/i.test(row.kind)).length,
            complaintCount: rows.filter((row) => /complaint/i.test(row.kind)).length,
            deliveredRouteCount: routes.filter((route) => route.state === 'delivered')
              .length,
            merchantChargeMilliEuro: charges.reduce(
              (total, charge) => total + charge.chargeMilliEuro,
              0
            ),
            providerCostCount: costs.length
          },
          cases: filtered.slice(0, 100).map(queueItem)
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
        const rows = await loadQueue()
        const row = rows.find((candidate) => candidate.caseId === caseId)
        if (!row?.intentId) throw denied('messaging-case-detail', 'case_not_found')
        const [
          intentRows,
          routeRows,
          attemptRows,
          evidenceRows,
          reservationRows,
          chargeRows,
          costRows
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
            .where(eq(providerMessagingCosts.intentId, row.intentId))
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
          }))
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
        const [rows, balances, charges, costs] = await Promise.all([
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
            .orderBy(asc(providerMessagingCosts.recordedAt))
        ])
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
          providerCosts: costs
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
      })
  })
}
