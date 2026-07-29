import { Effect, Layer, Schema } from 'effect'
import { and, asc, eq } from 'drizzle-orm'
import {
  Database,
  merchantMessagingBalanceSummaries,
  merchantNotificationDeliverySummaries,
  messagingTemplateVersions,
  notificationIntents,
  operationsMessagingCaseSummaries,
  operationsMessagingChannelControlSummaries,
  operationsMessagingChargeSummaries,
  operationsMessagingIncidentSummaries,
  operationsMessagingProviderCostSummaries,
  operationsMessagingRouteSummaries
} from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import {
  ControlledTemplate,
  ControlledTemplateEligibilityEngine,
  controlledTemplateCatalog,
  evaluateOperationalMessageEligibility,
  MessagingProjectionNotFound,
  MessagingReadModel,
  MerchantMessagingBalanceSummary,
  MerchantNotificationDeliverySummary,
  NotificationIntentUnavailable,
  NotificationIntents,
  OperationalMessageEligibilityInput,
  OperationalMessageIneligible,
  OperationsMessagingCaseSummary,
  OperationsMessagingChannelControlSummary,
  OperationsMessagingChargeSummary,
  OperationsMessagingIncidentSummary,
  OperationsMessagingProviderCostSummary,
  OperationsMessagingRouteSummary
} from './index.ts'

type Intent = typeof import('./index.ts').NotificationIntent.Type

export const SeedNotificationIntents = (
  records: readonly Intent[] = []
): Layer.Layer<NotificationIntents> =>
  Layer.succeed(NotificationIntents)({
    findById: (intentId) => {
      const intent = records.find((record) => record.id === intentId)
      return intent
        ? Effect.succeed(intent)
        : Effect.fail(new NotificationIntentUnavailable({ intentId }))
    }
  })

export const LiveNotificationIntents: Layer.Layer<
  NotificationIntents,
  never,
  Database
> = Layer.effect(
  NotificationIntents,
  Effect.gen(function* () {
    const db = yield* Database
    return {
      findById: (intentId) =>
        Effect.flatMap(
          orUnavailable('notification-intents')(
            db
              .select()
              .from(notificationIntents)
              .where(eq(notificationIntents.id, intentId))
              .limit(1)
          ),
          ([intent]) =>
            intent
              ? Effect.succeed({
                  id: intent.id,
                  shopId: intent.shopId,
                  topic: intent.topic,
                  sourceType: intent.sourceType,
                  sourceId: intent.sourceId,
                  ...(intent.sourceVersion === null
                    ? {}
                    : { sourceVersion: intent.sourceVersion }),
                  deduplicationKey: intent.deduplicationKey,
                  status: intent.status,
                  availableAt: intent.availableAt
                })
              : Effect.fail(new NotificationIntentUnavailable({ intentId }))
        )
    }
  })
)

type DeliverySummary =
  typeof import('./index.ts').MerchantNotificationDeliverySummary.Type
type BalanceSummary = typeof import('./index.ts').MerchantMessagingBalanceSummary.Type
type CaseSummary = typeof import('./index.ts').OperationsMessagingCaseSummary.Type
type RouteSummary = typeof import('./index.ts').OperationsMessagingRouteSummary.Type
type ChargeSummary = typeof import('./index.ts').OperationsMessagingChargeSummary.Type
type CostSummary =
  typeof import('./index.ts').OperationsMessagingProviderCostSummary.Type
type IncidentSummary =
  typeof import('./index.ts').OperationsMessagingIncidentSummary.Type
type ChannelControlSummary =
  typeof import('./index.ts').OperationsMessagingChannelControlSummary.Type

type SeedMessagingReadModelOptions = {
  readonly deliveries?: readonly DeliverySummary[]
  readonly balances?: readonly BalanceSummary[]
  readonly reconciliationCases?: readonly CaseSummary[]
  readonly routes?: readonly RouteSummary[]
  readonly charges?: readonly ChargeSummary[]
  readonly providerCosts?: readonly CostSummary[]
  readonly incidents?: readonly IncidentSummary[]
  readonly channelControls?: readonly ChannelControlSummary[]
}

export const SeedMessagingReadModel = (
  options: SeedMessagingReadModelOptions = {}
): Layer.Layer<MessagingReadModel> => {
  const deliveries = options.deliveries ?? []
  const balances = options.balances ?? []
  const cases = options.reconciliationCases ?? []
  const routes = options.routes ?? []
  const charges = options.charges ?? []
  const providerCosts = options.providerCosts ?? []
  const incidents = options.incidents ?? []
  const channelControls = options.channelControls ?? []
  return Layer.succeed(MessagingReadModel)({
    delivery: ({ shopId, intentId }) => {
      const summary = deliveries.find(
        (candidate) => candidate.shopId === shopId && candidate.intentId === intentId
      )
      return summary
        ? Effect.succeed(summary)
        : Effect.fail(
            new MessagingProjectionNotFound({
              projection: 'delivery',
              shopId,
              resourceId: intentId
            })
          )
    },
    balance: (shopId) => {
      const summary = balances.find((candidate) => candidate.shopId === shopId)
      return summary
        ? Effect.succeed(summary)
        : Effect.fail(
            new MessagingProjectionNotFound({ projection: 'balance', shopId })
          )
    },
    reconciliationCases: (input) =>
      Effect.succeed(
        cases.filter((candidate) => !input?.shopId || candidate.shopId === input.shopId)
      ),
    operationsSnapshot: (input) =>
      Effect.succeed({
        cases: cases.filter(
          (candidate) =>
            (!input?.shopId || candidate.shopId === input.shopId) &&
            (!input?.intentId || candidate.intentId === input.intentId)
        ),
        routes: routes.filter(
          (candidate) =>
            (!input?.shopId || candidate.shopId === input.shopId) &&
            (!input?.intentId || candidate.intentId === input.intentId)
        ),
        charges: charges.filter(
          (candidate) =>
            (!input?.shopId || candidate.shopId === input.shopId) &&
            (!input?.intentId || candidate.intentId === input.intentId)
        ),
        providerCosts: providerCosts.filter(
          (candidate) =>
            (!input?.shopId || candidate.shopId === input.shopId) &&
            (!input?.intentId || candidate.intentId === input.intentId)
        ),
        incidents: incidents.filter(
          (candidate) => !input?.shopId || candidate.shopId === input.shopId
        ),
        channelControls
      })
  })
}

const optional = <K extends string, V>(
  key: K,
  value: V | null
): { readonly [P in K]?: V } => (value === null ? {} : ({ [key]: value } as never))

const deliveryProjection = (
  row: typeof merchantNotificationDeliverySummaries.$inferSelect
) => ({
  intentId: row.intentId,
  shopId: row.shopId,
  sourceType: row.sourceType,
  sourceId: row.sourceId,
  ...optional('sourceVersion', row.sourceVersion),
  ...optional('purpose', row.purpose),
  ...optional('phase', row.phase),
  ...optional('result', row.result),
  ...optional('resultReason', row.resultReason),
  availableAt: row.availableAt,
  ...optional('terminalAt', row.terminalAt),
  ...optional('maskedDestination', row.maskedDestination),
  underReview: row.underReview
})

const caseProjection = (row: typeof operationsMessagingCaseSummaries.$inferSelect) => ({
  caseId: row.caseId,
  ...optional('shopId', row.shopId),
  ...optional('intentId', row.intentId),
  kind: row.kind,
  status: row.status,
  severity: row.severity,
  safeSummary: row.safeSummary,
  openedAt: row.openedAt,
  ...optional('resolvedAt', row.resolvedAt),
  ...optional('purpose', row.purpose),
  ...optional('intentPhase', row.intentPhase),
  ...optional('intentResult', row.intentResult),
  ...optional('maskedDestination', row.maskedDestination)
})

const decodeProjection = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, CapabilityUnavailable, R> =>
  Effect.mapError(
    effect,
    (error) =>
      new CapabilityUnavailable({
        capability: 'operational-messaging-read-model',
        reason: String(error)
      })
  )

export const LiveMessagingReadModel: Layer.Layer<MessagingReadModel, never, Database> =
  Layer.effect(
    MessagingReadModel,
    Effect.gen(function* () {
      const db = yield* Database
      return {
        delivery: ({ shopId, intentId }) =>
          Effect.flatMap(
            orUnavailable('operational-messaging-read-model')(
              db
                .select()
                .from(merchantNotificationDeliverySummaries)
                .where(
                  and(
                    eq(merchantNotificationDeliverySummaries.shopId, shopId),
                    eq(merchantNotificationDeliverySummaries.intentId, intentId)
                  )
                )
                .limit(1)
            ),
            ([row]): Effect.Effect<
              DeliverySummary,
              MessagingProjectionNotFound | CapabilityUnavailable
            > => {
              if (!row)
                return Effect.fail(
                  new MessagingProjectionNotFound({
                    projection: 'delivery',
                    shopId,
                    resourceId: intentId
                  })
                )
              return decodeProjection(
                Schema.decodeUnknownEffect(MerchantNotificationDeliverySummary)(
                  deliveryProjection(row)
                )
              )
            }
          ),
        balance: (shopId) =>
          Effect.flatMap(
            orUnavailable('operational-messaging-read-model')(
              db
                .select()
                .from(merchantMessagingBalanceSummaries)
                .where(eq(merchantMessagingBalanceSummaries.shopId, shopId))
                .limit(1)
            ),
            ([row]): Effect.Effect<
              BalanceSummary,
              MessagingProjectionNotFound | CapabilityUnavailable
            > => {
              if (!row)
                return Effect.fail(
                  new MessagingProjectionNotFound({ projection: 'balance', shopId })
                )
              return decodeProjection(
                Schema.decodeUnknownEffect(MerchantMessagingBalanceSummary)({
                  shopId: row.shopId,
                  currency: row.currency,
                  postedMilliEuro: row.postedMilliEuro,
                  reservedMilliEuro: row.reservedMilliEuro,
                  availableMilliEuro: row.availableMilliEuro,
                  financiallyFrozen: row.financiallyFrozen
                })
              )
            }
          ),
        reconciliationCases: (input) => {
          const query = input?.shopId
            ? db
                .select()
                .from(operationsMessagingCaseSummaries)
                .where(eq(operationsMessagingCaseSummaries.shopId, input.shopId))
                .orderBy(
                  asc(operationsMessagingCaseSummaries.openedAt),
                  asc(operationsMessagingCaseSummaries.caseId)
                )
            : db
                .select()
                .from(operationsMessagingCaseSummaries)
                .orderBy(
                  asc(operationsMessagingCaseSummaries.openedAt),
                  asc(operationsMessagingCaseSummaries.caseId)
                )
          return Effect.flatMap(
            orUnavailable('operational-messaging-read-model')(query),
            (rows) =>
              Effect.forEach(rows, (row) =>
                decodeProjection(
                  Schema.decodeUnknownEffect(OperationsMessagingCaseSummary)(
                    caseProjection(row)
                  )
                )
              )
          )
        },
        operationsSnapshot: (input) => {
          const caseQuery = input?.shopId
            ? db
                .select()
                .from(operationsMessagingCaseSummaries)
                .where(eq(operationsMessagingCaseSummaries.shopId, input.shopId))
            : db.select().from(operationsMessagingCaseSummaries)
          const routeQuery = input?.shopId
            ? db
                .select()
                .from(operationsMessagingRouteSummaries)
                .where(eq(operationsMessagingRouteSummaries.shopId, input.shopId))
            : db.select().from(operationsMessagingRouteSummaries)
          const chargeQuery = input?.shopId
            ? db
                .select()
                .from(operationsMessagingChargeSummaries)
                .where(eq(operationsMessagingChargeSummaries.shopId, input.shopId))
            : db.select().from(operationsMessagingChargeSummaries)
          const costQuery = input?.shopId
            ? db
                .select()
                .from(operationsMessagingProviderCostSummaries)
                .where(
                  eq(operationsMessagingProviderCostSummaries.shopId, input.shopId)
                )
            : db.select().from(operationsMessagingProviderCostSummaries)
          const incidentQuery = input?.shopId
            ? db
                .select()
                .from(operationsMessagingIncidentSummaries)
                .where(eq(operationsMessagingIncidentSummaries.shopId, input.shopId))
            : db.select().from(operationsMessagingIncidentSummaries)

          return Effect.gen(function* () {
            const [
              caseRows,
              routeRows,
              chargeRows,
              costRows,
              incidentRows,
              controlRows
            ] = yield* Effect.all([
              orUnavailable('operational-messaging-read-model')(caseQuery),
              orUnavailable('operational-messaging-read-model')(routeQuery),
              orUnavailable('operational-messaging-read-model')(chargeQuery),
              orUnavailable('operational-messaging-read-model')(costQuery),
              orUnavailable('operational-messaging-read-model')(incidentQuery),
              orUnavailable('operational-messaging-read-model')(
                db.select().from(operationsMessagingChannelControlSummaries)
              )
            ])
            const matchesIntent = <T extends { readonly intentId: string | null }>(
              row: T
            ) => !input?.intentId || row.intentId === input.intentId

            return {
              cases: yield* Effect.forEach(caseRows.filter(matchesIntent), (row) =>
                decodeProjection(
                  Schema.decodeUnknownEffect(OperationsMessagingCaseSummary)(
                    caseProjection(row)
                  )
                )
              ),
              routes: yield* Effect.forEach(routeRows.filter(matchesIntent), (row) =>
                decodeProjection(
                  Schema.decodeUnknownEffect(OperationsMessagingRouteSummary)({
                    routeId: row.routeId,
                    shopId: row.shopId,
                    intentId: row.intentId,
                    ordinal: row.ordinal,
                    channel: row.channel,
                    provider: row.provider,
                    state: row.state,
                    ...optional('ineligibleReason', row.ineligibleReason),
                    ...optional('acceptedAt', row.acceptedAt),
                    ...optional('deliveredAt', row.deliveredAt),
                    ...optional('terminalAt', row.terminalAt),
                    ...optional('latestEvidenceStatus', row.latestEvidenceStatus),
                    ...optional(
                      'latestEvidenceObservedAt',
                      row.latestEvidenceObservedAt
                    ),
                    attemptCount: row.attemptCount
                  })
                )
              ),
              charges: yield* Effect.forEach(chargeRows.filter(matchesIntent), (row) =>
                decodeProjection(
                  Schema.decodeUnknownEffect(OperationsMessagingChargeSummary)({
                    chargeId: row.chargeId,
                    shopId: row.shopId,
                    intentId: row.intentId,
                    routeId: row.routeId,
                    chargeMilliEuro: row.chargeMilliEuro,
                    verifiedAt: row.verifiedAt,
                    ...optional('ledgerEntryId', row.ledgerEntryId)
                  })
                )
              ),
              providerCosts: yield* Effect.forEach(
                costRows.filter(matchesIntent),
                (row) =>
                  decodeProjection(
                    Schema.decodeUnknownEffect(OperationsMessagingProviderCostSummary)({
                      costId: row.costId,
                      shopId: row.shopId,
                      intentId: row.intentId,
                      attemptId: row.attemptId,
                      provider: row.provider,
                      amountMinorUnits: row.amountMinorUnits,
                      currency: row.currency,
                      currencyScale: row.currencyScale,
                      units: row.units,
                      source: row.source,
                      recordedAt: row.recordedAt
                    })
                  )
              ),
              incidents: yield* Effect.forEach(incidentRows, (row) =>
                decodeProjection(
                  Schema.decodeUnknownEffect(OperationsMessagingIncidentSummary)({
                    incidentId: row.incidentId,
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
                  })
                )
              ),
              channelControls: yield* Effect.forEach(controlRows, (row) =>
                decodeProjection(
                  Schema.decodeUnknownEffect(OperationsMessagingChannelControlSummary)({
                    controlId: row.controlId,
                    environment: row.environment,
                    channel: row.channel,
                    provider: row.provider,
                    enabled: row.enabled,
                    ...optional('reason', row.reason),
                    updatedAt: row.updatedAt
                  })
                )
              )
            }
          })
        }
      }
    })
  )

export const LiveControlledTemplateEligibilityEngine: Layer.Layer<
  ControlledTemplateEligibilityEngine,
  never,
  Database
> = Layer.effect(
  ControlledTemplateEligibilityEngine,
  Effect.gen(function* () {
    const db = yield* Database
    return {
      evaluate: (rawInput) =>
        Effect.gen(function* () {
          const input = yield* Schema.decodeUnknownEffect(
            OperationalMessageEligibilityInput
          )(rawInput).pipe(
            Effect.mapError(
              () =>
                new OperationalMessageIneligible({
                  reason: 'invalid_eligibility_input'
                })
            )
          )
          const [row] = yield* orUnavailable('controlled-template-eligibility')(
            db
              .select()
              .from(messagingTemplateVersions)
              .where(
                and(
                  eq(messagingTemplateVersions.purpose, input.purpose),
                  eq(messagingTemplateVersions.locale, input.locale),
                  eq(messagingTemplateVersions.channel, input.channel),
                  eq(messagingTemplateVersions.version, input.templateVersion)
                )
              )
              .limit(1)
          )
          const controlled = controlledTemplateCatalog.find(
            (template) =>
              template.purpose === input.purpose &&
              template.locale === input.locale &&
              template.channel === input.channel &&
              template.version === input.templateVersion
          )
          if (!row || !controlled)
            return yield* evaluateOperationalMessageEligibility(input, {
              catalog: []
            })

          const providerApproval =
            row.channel === 'whatsapp'
              ? {
                  provider: 'meta' as const,
                  templateKey: row.providerTemplateKey ?? '',
                  requestedCategory: row.providerRequestedCategory ?? 'utility',
                  ...optional('observedCategory', row.providerObservedCategory),
                  status: row.providerApprovalStatus,
                  ...optional('approvedAt', row.providerApprovedAt),
                  ...optional(
                    'evidenceReference',
                    row.providerApprovalEvidenceReference
                  )
                }
              : null
          const template = yield* decodeProjection(
            Schema.decodeUnknownEffect(ControlledTemplate)({
              ...controlled,
              bodyFingerprint: row.bodyFingerprint,
              enabled:
                row.enabled &&
                row.providerApprovalStatus !== 'disabled' &&
                row.effectiveAt <= input.now &&
                (!row.retiredAt || row.retiredAt > input.now),
              providerApproval
            })
          )
          return yield* evaluateOperationalMessageEligibility(input, {
            catalog: [template]
          })
        })
    }
  })
)
