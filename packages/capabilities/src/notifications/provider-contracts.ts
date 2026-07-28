import { Context, Effect, Schema } from 'effect'

export const MessagingProvider = Schema.Literals(['meta', 'smso'])
export const MessagingChannel = Schema.Literals(['whatsapp', 'sms'])
export const MessagingLocale = Schema.Literals(['ro', 'en'])
export const OperationalNotificationPurpose = Schema.Literals([
  'appointment_confirmation',
  'appointment_reminder',
  'appointment_cancellation',
  'appointment_reschedule'
])

const ProtectedString = (label: string) =>
  Schema.Redacted(Schema.String, { label, disallowJsonEncode: true })

export const ProviderSubmissionRequest = Schema.Struct({
  attemptId: Schema.String,
  intentId: Schema.String,
  routeId: Schema.String,
  provider: MessagingProvider,
  channel: MessagingChannel,
  locale: MessagingLocale,
  purpose: OperationalNotificationPurpose,
  templateVersion: Schema.String,
  idempotencyKey: Schema.String,
  destination: ProtectedString('Protected Messaging Destination'),
  renderedBody: ProtectedString('Rendered Operational Message'),
  credential: Schema.optional(ProtectedString('Provider Credential')),
  bodyFingerprint: Schema.String
})

export const ProviderSubmissionOutcome = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('captured'),
    captureId: Schema.String,
    capturedAt: Schema.String
  }),
  Schema.Struct({
    _tag: Schema.Literal('accepted'),
    providerReferenceFingerprint: Schema.String,
    acceptedAt: Schema.String
  }),
  Schema.Struct({
    _tag: Schema.Literal('rejected'),
    classification: Schema.Literals(['retryable', 'terminal']),
    code: Schema.String
  }),
  Schema.Struct({
    _tag: Schema.Literal('throttled'),
    retryAfterSeconds: Schema.Number
  }),
  Schema.Struct({
    _tag: Schema.Literal('ambiguous'),
    observedAt: Schema.String
  })
])

export const ProviderEvidence = Schema.Struct({
  evidenceId: Schema.String,
  attemptId: Schema.String,
  intentId: Schema.String,
  provider: MessagingProvider,
  source: Schema.Literals(['response', 'callback', 'query', 'operator']),
  status: Schema.Literals(['accepted', 'delivered', 'read', 'terminal_failure']),
  observedAt: Schema.String,
  providerOccurredAt: Schema.optional(Schema.String),
  providerReferenceFingerprint: Schema.String,
  trusted: Schema.Boolean,
  code: Schema.optional(Schema.String)
})

export const ProviderCallbackRequest = Schema.Struct({
  provider: MessagingProvider,
  receivedAt: Schema.String,
  rawBody: ProtectedString('Raw Provider Callback'),
  signature: Schema.optional(ProtectedString('Provider Callback Signature'))
})

export const ProviderCallbackOutcome = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('verified'),
    evidence: Schema.Array(ProviderEvidence)
  }),
  Schema.Struct({
    _tag: Schema.Literal('untrusted_hint'),
    providerReferenceFingerprint: Schema.String
  }),
  Schema.Struct({
    _tag: Schema.Literal('rejected'),
    code: Schema.String
  })
])

export const ProviderQueryRequest = Schema.Struct({
  provider: MessagingProvider,
  attemptId: Schema.String,
  intentId: Schema.String,
  providerReference: ProtectedString('Provider Reference'),
  providerReferenceFingerprint: Schema.String
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
  costFactId: Schema.String,
  attemptId: Schema.String,
  intentId: Schema.String,
  provider: MessagingProvider,
  amountMilliEuro: Schema.Int,
  currency: Schema.Literal('EUR'),
  units: Schema.Int,
  recordedAt: Schema.String,
  source: Schema.Literals(['response', 'callback', 'query', 'invoice'])
})

export const ProviderQueueWakeup = Schema.Struct({
  version: Schema.Literal(1),
  kind: Schema.Literal('notification-intent'),
  intentId: Schema.String
})

const MaskedRomanianDestination = Schema.String.check(
  Schema.isPattern(/^\+40•{7}\d{3}$/)
)

export const ProviderCaptureRecord = Schema.Struct({
  captureId: Schema.String,
  capturedAt: Schema.String,
  provider: MessagingProvider,
  channel: MessagingChannel,
  locale: MessagingLocale,
  purpose: OperationalNotificationPurpose,
  templateVersion: Schema.String,
  attemptId: Schema.String,
  intentId: Schema.String,
  destination: MaskedRomanianDestination,
  bodyFingerprint: Schema.String
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
    code: Schema.String
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
    attemptId: string
  ) => Effect.Effect<readonly CostFact[], ProviderContractFailure>
}

export class ProviderCostReader extends Context.Service<
  ProviderCostReader,
  ProviderCostReaderShape
>()('@b2b-saas-starter/capabilities/notifications/ProviderCostReader') {}

export type ProviderRuntime = 'local' | 'test' | 'preview' | 'production'
export type ProviderRuntimeState = 'capture' | 'needs_configuration'
