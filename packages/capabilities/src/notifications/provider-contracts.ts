import { Context, Effect, Schema } from 'effect'
import { NotificationIntentId } from '../ids.ts'

export const MessagingProvider = Schema.Literals(['meta', 'smso'])
export const MessagingChannel = Schema.Literals(['whatsapp', 'sms'])
export const MessagingLocale = Schema.Literals(['ro', 'en'])
export const OperationalNotificationPurpose = Schema.Literals([
  'appointment_confirmation',
  'appointment_reminder',
  'appointment_cancellation',
  'appointment_reschedule'
])

export const ProtectedNotificationMaterial = Schema.Redacted(Schema.String, {
  disallowJsonEncode: true
})

const stableId = (prefix: string) =>
  Schema.String.check(Schema.isPattern(new RegExp(`^${prefix}_[A-Za-z0-9_-]+$`)))

export const ProviderAttemptId = stableId('pat')
export const ProviderRouteId = stableId('prt')
export const ProviderEvidenceId = stableId('pevd')
export const ProviderCaptureId = stableId('pcap')
export const ProviderCostFactId = stableId('pcst')
export const ProviderIdempotencyKey = stableId('idem')
export const ProviderFingerprint = Schema.String.check(
  Schema.isPattern(/^sha256:[a-f0-9]{64}$/)
)
export const ProviderTemplateVersion = Schema.String.check(
  Schema.isPattern(/^v[1-9]\d*$/)
)
export const ProviderUtcInstant = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/)
)
export const NormalizedProviderCode = Schema.Literals([
  'provider_rejected',
  'provider_terminal_failure',
  'contradictory_terminal_failure',
  'invalid_signature',
  'invalid_method',
  'payload_too_large',
  'malformed_callback',
  'provider_timeout',
  'provider_not_configured',
  'provider_mismatch',
  'provider_transport_error',
  'malformed_provider_evidence'
])

const ProviderSubmissionFields = {
  attemptId: ProviderAttemptId,
  intentId: NotificationIntentId,
  routeId: ProviderRouteId,
  locale: MessagingLocale,
  purpose: OperationalNotificationPurpose,
  templateVersion: ProviderTemplateVersion,
  idempotencyKey: ProviderIdempotencyKey,
  destination: ProtectedNotificationMaterial,
  renderedBody: ProtectedNotificationMaterial,
  credential: Schema.optional(ProtectedNotificationMaterial),
  bodyFingerprint: ProviderFingerprint
} as const

export const ProviderSubmissionRequest = Schema.Union([
  Schema.Struct({
    ...ProviderSubmissionFields,
    provider: Schema.Literal('meta'),
    channel: Schema.Literal('whatsapp')
  }),
  Schema.Struct({
    ...ProviderSubmissionFields,
    provider: Schema.Literal('smso'),
    channel: Schema.Literal('sms')
  })
])

export const ProviderSubmissionOutcome = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('captured'),
    captureId: ProviderCaptureId,
    capturedAt: ProviderUtcInstant
  }),
  Schema.Struct({
    _tag: Schema.Literal('accepted'),
    providerReferenceFingerprint: ProviderFingerprint,
    acceptedAt: ProviderUtcInstant
  }),
  Schema.Struct({
    _tag: Schema.Literal('rejected'),
    classification: Schema.Literals(['retryable', 'terminal']),
    code: NormalizedProviderCode
  }),
  Schema.Struct({
    _tag: Schema.Literal('throttled'),
    retryAfterSeconds: Schema.Number
  }),
  Schema.Struct({
    _tag: Schema.Literal('ambiguous'),
    observedAt: ProviderUtcInstant
  })
])

export const ProviderEvidence = Schema.Struct({
  evidenceId: ProviderEvidenceId,
  attemptId: ProviderAttemptId,
  intentId: NotificationIntentId,
  provider: MessagingProvider,
  source: Schema.Literals(['response', 'callback', 'query', 'operator']),
  status: Schema.Literals(['accepted', 'delivered', 'read', 'terminal_failure']),
  observedAt: ProviderUtcInstant,
  providerOccurredAt: Schema.optional(ProviderUtcInstant),
  providerReferenceFingerprint: ProviderFingerprint,
  trusted: Schema.Boolean,
  code: Schema.optional(NormalizedProviderCode)
})

export const ProviderCallbackRequest = Schema.Struct({
  provider: MessagingProvider,
  receivedAt: ProviderUtcInstant,
  rawBody: ProtectedNotificationMaterial,
  signature: Schema.optional(ProtectedNotificationMaterial)
})

export const ProviderCallbackOutcome = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('verified'),
    evidence: Schema.Array(ProviderEvidence)
  }),
  Schema.Struct({
    _tag: Schema.Literal('untrusted_hint'),
    providerReferenceFingerprint: ProviderFingerprint
  }),
  Schema.Struct({
    _tag: Schema.Literal('rejected'),
    code: NormalizedProviderCode
  })
])

export const ProviderQueryRequest = Schema.Struct({
  provider: MessagingProvider,
  attemptId: ProviderAttemptId,
  intentId: NotificationIntentId,
  providerReference: ProtectedNotificationMaterial,
  providerReferenceFingerprint: ProviderFingerprint
})

export const ProviderQueryOutcome = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('evidence'),
    evidence: ProviderEvidence
  }),
  Schema.Struct({ _tag: Schema.Literal('not_found') }),
  Schema.Struct({
    _tag: Schema.Literal('throttled'),
    retryAfterSeconds: Schema.Number
  })
])

export const ProviderCostFact = Schema.Struct({
  costFactId: ProviderCostFactId,
  attemptId: ProviderAttemptId,
  intentId: NotificationIntentId,
  provider: MessagingProvider,
  amountMilliEuro: Schema.Int,
  currency: Schema.Literal('EUR'),
  units: Schema.Int,
  recordedAt: ProviderUtcInstant,
  source: Schema.Literals(['response', 'callback', 'query', 'invoice'])
})

export const ProviderQueueWakeup = Schema.Struct({
  version: Schema.Literal(1),
  kind: Schema.Literal('notification-intent'),
  intentId: NotificationIntentId
})
export const BookingOutboxQueueWakeup = Schema.Struct({
  version: Schema.Literal(1),
  kind: Schema.Literal('booking-outbox'),
  outboxId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))
})
export const BookingEventsWakeupSchema = Schema.Union([
  BookingOutboxQueueWakeup,
  ProviderQueueWakeup
])
export type BookingEventsWakeup = typeof BookingEventsWakeupSchema.Type

const MaskedRomanianDestination = Schema.String.check(
  Schema.isPattern(/^\+40•{7}\d{3}$/)
)

export const ProviderCaptureRecord = Schema.Struct({
  captureId: ProviderCaptureId,
  capturedAt: ProviderUtcInstant,
  provider: MessagingProvider,
  channel: MessagingChannel,
  locale: MessagingLocale,
  purpose: OperationalNotificationPurpose,
  templateVersion: ProviderTemplateVersion,
  attemptId: ProviderAttemptId,
  intentId: NotificationIntentId,
  destination: MaskedRomanianDestination,
  bodyFingerprint: ProviderFingerprint
})

export class ProviderContractFailure extends Schema.TaggedErrorClass<ProviderContractFailure>()(
  'ProviderContractFailure',
  {
    provider: MessagingProvider,
    operation: Schema.Literals(['submit', 'verify_callback', 'query', 'read_cost']),
    reason: Schema.Literals([
      'needs_configuration',
      'timeout',
      'transport',
      'malformed_evidence'
    ]),
    code: NormalizedProviderCode
  }
) {}

type SubmissionRequest = typeof ProviderSubmissionRequest.Type
type SubmissionOutcome = typeof ProviderSubmissionOutcome.Type
type CallbackRequest = typeof ProviderCallbackRequest.Type
type CallbackOutcome = typeof ProviderCallbackOutcome.Type
type QueryRequest = typeof ProviderQueryRequest.Type
type QueryOutcome = typeof ProviderQueryOutcome.Type
type CostFact = typeof ProviderCostFact.Type

export type ProviderSubmissionShape = {
  readonly submit: (
    request: SubmissionRequest
  ) => Effect.Effect<SubmissionOutcome, ProviderContractFailure>
}

export class ProviderSubmission extends Context.Service<
  ProviderSubmission,
  ProviderSubmissionShape
>()('@b2b-saas-starter/capabilities/notifications/ProviderSubmission') {}

export type ProviderCallbackVerificationShape = {
  readonly verify: (
    request: CallbackRequest
  ) => Effect.Effect<CallbackOutcome, ProviderContractFailure>
}

export class ProviderCallbackVerification extends Context.Service<
  ProviderCallbackVerification,
  ProviderCallbackVerificationShape
>()('@b2b-saas-starter/capabilities/notifications/ProviderCallbackVerification') {}

export type ProviderQueryShape = {
  readonly query: (
    request: QueryRequest
  ) => Effect.Effect<QueryOutcome, ProviderContractFailure>
}

export class ProviderQuery extends Context.Service<ProviderQuery, ProviderQueryShape>()(
  '@b2b-saas-starter/capabilities/notifications/ProviderQuery'
) {}

export type ProviderCostReaderShape = {
  readonly read: (
    attemptId: typeof ProviderAttemptId.Type
  ) => Effect.Effect<readonly CostFact[], ProviderContractFailure>
}

export class ProviderCostReader extends Context.Service<
  ProviderCostReader,
  ProviderCostReaderShape
>()('@b2b-saas-starter/capabilities/notifications/ProviderCostReader') {}

export type ProviderRuntime = 'local' | 'test' | 'preview' | 'production'
export type ProviderRuntimeState = 'capture' | 'needs_configuration'
