import { Context, Effect, Schema } from 'effect'
import { CapabilityUnavailable } from '../errors.ts'
import { NotificationIntentId, ShopId } from '../ids.ts'

export * from './provider-contracts.ts'
export * from './controlled-template-eligibility.ts'
export * from './messaging-finance.ts'
export * from './notification-intent-lifecycle.ts'
export * from './booking-intent-producer.ts'

export const NotificationIntent = Schema.Struct({
  id: NotificationIntentId,
  shopId: ShopId,
  topic: Schema.String,
  sourceType: Schema.String,
  sourceId: Schema.String,
  sourceVersion: Schema.optional(Schema.Number),
  deduplicationKey: Schema.String,
  status: Schema.Literals([
    'pending',
    'processing',
    'delivered',
    'failed',
    'cancelled'
  ]),
  availableAt: Schema.String
})
export class NotificationIntentUnavailable extends Schema.TaggedErrorClass<NotificationIntentUnavailable>()(
  'NotificationIntentUnavailable',
  { intentId: Schema.String }
) {}

export type NotificationIntentsShape = {
  readonly findById: (
    intentId: string
  ) => Effect.Effect<
    typeof NotificationIntent.Type,
    NotificationIntentUnavailable | CapabilityUnavailable
  >
}

export class NotificationIntents extends Context.Service<
  NotificationIntents,
  NotificationIntentsShape
>()('@b2b-saas-starter/capabilities/NotificationIntents') {}

export const MerchantNotificationDeliverySummary = Schema.Struct({
  intentId: NotificationIntentId,
  shopId: ShopId,
  sourceType: Schema.String,
  sourceId: Schema.String,
  sourceVersion: Schema.optional(Schema.Int),
  purpose: Schema.optional(
    Schema.Literals([
      'appointment_confirmation',
      'appointment_reminder',
      'appointment_cancellation',
      'appointment_reschedule'
    ])
  ),
  phase: Schema.optional(
    Schema.Literals(['scheduled', 'ready', 'routing', 'awaiting_provider', 'terminal'])
  ),
  result: Schema.optional(
    Schema.Literals(['delivered', 'not_sent', 'delivery_failed'])
  ),
  resultReason: Schema.optional(Schema.String),
  availableAt: Schema.String,
  terminalAt: Schema.optional(Schema.String),
  maskedDestination: Schema.optional(Schema.String),
  underReview: Schema.Boolean
})

export const MerchantMessagingBalanceSummary = Schema.Struct({
  shopId: ShopId,
  currency: Schema.Literal('EUR'),
  postedMilliEuro: Schema.Int,
  reservedMilliEuro: Schema.Int,
  availableMilliEuro: Schema.Int,
  financiallyFrozen: Schema.Boolean
})

export const OperationsMessagingCaseSummary = Schema.Struct({
  caseId: Schema.String,
  shopId: Schema.optional(ShopId),
  intentId: Schema.optional(NotificationIntentId),
  kind: Schema.String,
  status: Schema.Literals(['open', 'investigating', 'resolved', 'waived']),
  severity: Schema.Literals(['low', 'medium', 'high', 'critical']),
  safeSummary: Schema.String,
  openedAt: Schema.String,
  resolvedAt: Schema.optional(Schema.String),
  purpose: Schema.optional(
    Schema.Literals([
      'appointment_confirmation',
      'appointment_reminder',
      'appointment_cancellation',
      'appointment_reschedule'
    ])
  ),
  intentPhase: Schema.optional(
    Schema.Literals(['scheduled', 'ready', 'routing', 'awaiting_provider', 'terminal'])
  ),
  intentResult: Schema.optional(
    Schema.Literals(['delivered', 'not_sent', 'delivery_failed'])
  ),
  maskedDestination: Schema.optional(Schema.String)
})

export const OperationsMessagingRouteSummary = Schema.Struct({
  routeId: Schema.String,
  shopId: ShopId,
  intentId: NotificationIntentId,
  ordinal: Schema.Int,
  channel: Schema.Literals(['whatsapp', 'sms']),
  provider: Schema.Literals(['meta', 'smso']),
  state: Schema.Literals([
    'planned',
    'eligible',
    'submitting',
    'accepted',
    'delivered',
    'ineligible',
    'submission_unknown',
    'terminal_failure'
  ]),
  ineligibleReason: Schema.optional(Schema.String),
  acceptedAt: Schema.optional(Schema.String),
  deliveredAt: Schema.optional(Schema.String),
  terminalAt: Schema.optional(Schema.String),
  latestEvidenceStatus: Schema.optional(
    Schema.Literals(['accepted', 'delivered', 'read', 'terminal_failure'])
  ),
  latestEvidenceObservedAt: Schema.optional(Schema.String),
  attemptCount: Schema.Int
})

export const OperationsMessagingChargeSummary = Schema.Struct({
  chargeId: Schema.String,
  shopId: ShopId,
  intentId: NotificationIntentId,
  routeId: Schema.String,
  chargeMilliEuro: Schema.Int,
  verifiedAt: Schema.String,
  ledgerEntryId: Schema.optional(Schema.String)
})

export const OperationsMessagingProviderCostSummary = Schema.Struct({
  costId: Schema.String,
  shopId: ShopId,
  intentId: NotificationIntentId,
  attemptId: Schema.String,
  provider: Schema.Literals(['meta', 'smso']),
  amountMinorUnits: Schema.Int,
  currency: Schema.String,
  currencyScale: Schema.Int,
  units: Schema.Int,
  source: Schema.Literals(['response', 'callback', 'query', 'invoice']),
  recordedAt: Schema.String
})

export const OperationsMessagingIncidentSummary = Schema.Struct({
  incidentId: Schema.String,
  shopId: Schema.optional(ShopId),
  provider: Schema.optional(Schema.Literals(['meta', 'smso'])),
  channel: Schema.optional(Schema.Literals(['whatsapp', 'sms'])),
  kind: Schema.String,
  status: Schema.Literals(['open', 'contained', 'recovering', 'resolved']),
  severity: Schema.Literals(['low', 'medium', 'high', 'critical']),
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

export const OperationsMessagingChannelControlSummary = Schema.Struct({
  controlId: Schema.String,
  environment: Schema.String,
  channel: Schema.Literals(['whatsapp', 'sms']),
  provider: Schema.Literals(['meta', 'smso']),
  enabled: Schema.Boolean,
  reason: Schema.optional(Schema.String),
  updatedAt: Schema.String
})

export const OperationsMessagingSnapshot = Schema.Struct({
  cases: Schema.Array(OperationsMessagingCaseSummary),
  routes: Schema.Array(OperationsMessagingRouteSummary),
  charges: Schema.Array(OperationsMessagingChargeSummary),
  providerCosts: Schema.Array(OperationsMessagingProviderCostSummary),
  incidents: Schema.Array(OperationsMessagingIncidentSummary),
  channelControls: Schema.Array(OperationsMessagingChannelControlSummary)
})

export class MessagingProjectionNotFound extends Schema.TaggedErrorClass<MessagingProjectionNotFound>()(
  'MessagingProjectionNotFound',
  {
    projection: Schema.Literals(['delivery', 'balance']),
    shopId: Schema.String,
    resourceId: Schema.optional(Schema.String)
  }
) {}

type DeliverySummary = typeof MerchantNotificationDeliverySummary.Type
type BalanceSummary = typeof MerchantMessagingBalanceSummary.Type
type CaseSummary = typeof OperationsMessagingCaseSummary.Type
type OperationsSnapshot = typeof OperationsMessagingSnapshot.Type

export type MessagingReadModelShape = {
  readonly delivery: (input: {
    readonly shopId: string
    readonly intentId: string
  }) => Effect.Effect<
    DeliverySummary,
    MessagingProjectionNotFound | CapabilityUnavailable
  >
  readonly balance: (
    shopId: string
  ) => Effect.Effect<
    BalanceSummary,
    MessagingProjectionNotFound | CapabilityUnavailable
  >
  readonly reconciliationCases: (input?: {
    readonly shopId?: string
  }) => Effect.Effect<readonly CaseSummary[], CapabilityUnavailable>
  readonly operationsSnapshot: (input?: {
    readonly shopId?: string
    readonly intentId?: string
  }) => Effect.Effect<OperationsSnapshot, CapabilityUnavailable>
}

export class MessagingReadModel extends Context.Service<
  MessagingReadModel,
  MessagingReadModelShape
>()('@b2b-saas-starter/capabilities/notifications/MessagingReadModel') {}
