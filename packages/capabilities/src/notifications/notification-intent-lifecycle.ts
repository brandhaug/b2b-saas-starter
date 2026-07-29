import { Context, Effect, Layer, Schema } from 'effect'
import { CapabilityUnavailable } from '../errors.ts'
import {
  type ControlledTemplateEligibilityEngineShape,
  evaluateOperationalMessageEligibility,
  OperationalMessageEligibilityInput,
  ProtectedMessagingDestination
} from './controlled-template-eligibility.ts'

const PersistedProtectedMessagingDestination = Schema.Struct({
  ...ProtectedMessagingDestination.fields,
  ciphertext: Schema.String
})

export const NotificationIntentPhase = Schema.Literals([
  'scheduled',
  'ready',
  'routing',
  'awaiting_provider',
  'terminal'
])
export const NotificationIntentResult = Schema.Literals([
  'delivered',
  'not_sent',
  'delivery_failed'
])
export const DeliveryRouteState = Schema.Literals([
  'planned',
  'eligible',
  'submitting',
  'accepted',
  'delivered',
  'ineligible',
  'submission_unknown',
  'terminal_failure'
])
export const SubmissionAttemptState = Schema.Literals([
  'prepared',
  'submitting',
  'captured',
  'accepted',
  'rejected_retryable',
  'rejected_terminal',
  'submission_unknown'
])
export const ProviderEvidenceStatus = Schema.Literals([
  'captured',
  'accepted',
  'rejected_retryable',
  'rejected_terminal',
  'submission_unknown',
  'delivered',
  'read',
  'terminal_failure'
])

export type NotificationPurpose =
  | 'appointment_confirmation'
  | 'appointment_reminder'
  | 'appointment_cancellation'
  | 'appointment_reschedule'
export type NotificationChannel = 'whatsapp' | 'sms'
export type NotificationProvider = 'meta' | 'smso'
export type IntentPhase = typeof NotificationIntentPhase.Type
export type IntentResult = typeof NotificationIntentResult.Type
export type RouteState = typeof DeliveryRouteState.Type
export type AttemptState = typeof SubmissionAttemptState.Type
export type EvidenceStatus = typeof ProviderEvidenceStatus.Type

export const PrepareNotificationIntent = Schema.Struct({
  id: Schema.String,
  shopId: Schema.String,
  topic: Schema.String,
  sourceType: Schema.String,
  sourceId: Schema.String,
  sourceVersion: Schema.Int,
  recipientRole: Schema.String,
  recipientSnapshot: PersistedProtectedMessagingDestination,
  deduplicationKey: Schema.String,
  purpose: Schema.Literals([
    'appointment_confirmation',
    'appointment_reminder',
    'appointment_cancellation',
    'appointment_reschedule'
  ]),
  locale: Schema.Literals(['ro', 'en']),
  availableAt: Schema.String,
  createdAt: Schema.String,
  manual: Schema.optional(
    Schema.Struct({ commandKey: Schema.String, actorId: Schema.String })
  )
})
export type PrepareNotificationIntentInput = typeof PrepareNotificationIntent.Type

type MutableDeep<A> = A extends readonly (infer Item)[]
  ? MutableDeep<Item>[]
  : A extends object
    ? { -readonly [Key in keyof A]: MutableDeep<A[Key]> }
    : A

export type SubmissionAttempt = typeof SubmissionAttemptSchema.Type
export type SubmissionOutcome = typeof SubmissionOutcomeSchema.Type
export type IntentProviderEvidence = typeof IntentProviderEvidenceSchema.Type
export type DeliveryRoute = MutableDeep<typeof DeliveryRouteSchema.Type>
export type NotificationIntentAggregate = MutableDeep<
  typeof NotificationIntentAggregateSchema.Type
>

const SubmissionAttemptSchema = Schema.Struct({
  id: Schema.String,
  ordinal: Schema.Int,
  idempotencyKey: Schema.String,
  requestFingerprint: Schema.String,
  startedAt: Schema.String,
  state: Schema.Literal('submitting')
})
const SubmissionOutcomeSchema = Schema.Struct({
  attemptId: Schema.String,
  outcome: Schema.Literals([
    'captured',
    'accepted',
    'rejected_retryable',
    'rejected_terminal',
    'submission_unknown'
  ]),
  observedAt: Schema.String
})
const IntentProviderEvidenceSchema = Schema.Struct({
  id: Schema.String,
  attemptId: Schema.String,
  environment: Schema.String,
  provider: Schema.Literals(['meta', 'smso']),
  providerAccountKey: Schema.String,
  source: Schema.Literals(['response', 'callback', 'query', 'operator']),
  sourceEventKey: Schema.String,
  providerReferenceFingerprint: Schema.optional(Schema.String),
  status: ProviderEvidenceStatus,
  trusted: Schema.Boolean,
  observedAt: Schema.String
})
const DeliveryRouteSchema = Schema.Struct({
  id: Schema.String,
  ordinal: Schema.Int,
  channel: Schema.Literals(['whatsapp', 'sms']),
  provider: Schema.Literals(['meta', 'smso']),
  state: DeliveryRouteState,
  ineligibleReason: Schema.optional(Schema.String),
  acceptedAt: Schema.optional(Schema.String),
  deliveredAt: Schema.optional(Schema.String),
  terminalAt: Schema.optional(Schema.String),
  retryAvailableAt: Schema.optional(Schema.String),
  attempts: Schema.Array(SubmissionAttemptSchema),
  submissionOutcomes: Schema.Array(SubmissionOutcomeSchema),
  evidence: Schema.Array(IntentProviderEvidenceSchema)
})
export const NotificationIntentAggregateSchema = Schema.Struct({
  ...PrepareNotificationIntent.fields,
  phase: NotificationIntentPhase,
  result: Schema.optional(NotificationIntentResult),
  resultReason: Schema.optional(Schema.String),
  terminalAt: Schema.optional(Schema.String),
  supersededAt: Schema.optional(Schema.String),
  supersededAfterSubmission: Schema.Boolean,
  ambiguitySince: Schema.optional(Schema.String),
  reservation: Schema.optional(
    Schema.Struct({
      id: Schema.String,
      rateCardId: Schema.String,
      amountMilliEuro: Schema.Int,
      status: Schema.Literals(['active', 'converted', 'released']),
      releasedAt: Schema.optional(Schema.String),
      releaseReason: Schema.optional(Schema.String)
    })
  ),
  chargeableDelivery: Schema.optional(
    Schema.Struct({
      id: Schema.String,
      routeId: Schema.String,
      reservationId: Schema.String,
      rateCardId: Schema.String,
      chargeMilliEuro: Schema.Int,
      verifiedAt: Schema.String
    })
  ),
  routes: Schema.Array(DeliveryRouteSchema),
  reconciliationCases: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      kind: Schema.Literal('contradictory_evidence'),
      sourceIdentity: Schema.String,
      openedAt: Schema.String,
      status: Schema.Literal('open')
    })
  )
})

export class NotificationIntentRejected extends Schema.TaggedErrorClass<NotificationIntentRejected>()(
  'NotificationIntentRejected',
  {
    operation: Schema.String,
    reason: Schema.Literals([
      'intent_unavailable',
      'invalid_transition',
      'reservation_required',
      'route_unavailable',
      'route_not_eligible',
      'submission_unknown_reconciliation_only',
      'retry_limit_reached',
      'attempt_unavailable',
      'ambiguity_window_active',
      'manual_rate_limited',
      'idempotency_conflict'
    ]),
    intentId: Schema.optional(Schema.String)
  }
) {}

type LifecycleError = NotificationIntentRejected | CapabilityUnavailable

type ProviderSubmissionOutcomeInput = {
  readonly intentId: string
  readonly attemptId: string
  readonly now: string
  readonly providerReferenceFingerprint?: string
} & (
  | { readonly outcome: 'captured' }
  | {
      readonly outcome:
        | 'accepted'
        | 'rejected_retryable'
        | 'rejected_terminal'
        | 'submission_unknown'
      readonly environment: string
      readonly providerAccountKey: string
      readonly sourceEventKey: string
    }
)

export type NotificationIntentLifecycleShape = {
  readonly prepare: (
    input: PrepareNotificationIntentInput
  ) => Effect.Effect<NotificationIntentAggregate, LifecycleError>
  readonly createManual: (
    input: PrepareNotificationIntentInput & {
      readonly manual: NonNullable<PrepareNotificationIntentInput['manual']>
    }
  ) => Effect.Effect<NotificationIntentAggregate, LifecycleError>
  readonly findById: (
    intentId: string
  ) => Effect.Effect<NotificationIntentAggregate, LifecycleError>
  readonly listBySource: (input: {
    readonly shopId: string
    readonly sourceType: string
    readonly sourceId: string
  }) => Effect.Effect<readonly NotificationIntentAggregate[], LifecycleError>
  readonly beginRouting: (input: {
    readonly intentId: string
    readonly environment: string
    readonly eligibility: {
      readonly whatsapp: OperationalMessageEligibilityInput
      readonly sms: OperationalMessageEligibilityInput
    }
    readonly expiresAt?: string
    /** @deprecated Ignored; financial authority creates the reservation. */
    readonly reservationId?: string
    /** @deprecated Ignored; financial authority snapshots the Rate Card. */
    readonly rateCardId?: string
    /** @deprecated Ignored; financial authority determines the charge. */
    readonly chargeMilliEuro?: number
    readonly now: string
  }) => Effect.Effect<NotificationIntentAggregate, LifecycleError>
  readonly markNotSent: (input: {
    readonly intentId: string
    readonly reason:
      | 'suppressed'
      | 'insufficient_balance'
      | 'no_eligible_route'
      | 'invalid_destination'
      | 'needs_configuration'
      | 'rate_limited'
    readonly now: string
  }) => Effect.Effect<NotificationIntentAggregate, LifecycleError>
  readonly recordRouteIneligible: (input: {
    readonly intentId: string
    readonly channel: NotificationChannel
    readonly reason: string
    readonly now: string
  }) => Effect.Effect<NotificationIntentAggregate, LifecycleError>
  readonly prepareSubmission: (input: {
    readonly intentId: string
    readonly environment: string
    readonly channel: NotificationChannel
    readonly eligibility: OperationalMessageEligibilityInput
    readonly requestFingerprint: string
    readonly now: string
  }) => Effect.Effect<
    {
      readonly intent: NotificationIntentAggregate
      readonly route: DeliveryRoute
      readonly attempt: SubmissionAttempt
    },
    LifecycleError
  >
  readonly recordSubmissionOutcome: (
    input: ProviderSubmissionOutcomeInput
  ) => Effect.Effect<NotificationIntentAggregate, LifecycleError>
  readonly ingestEvidence: (input: {
    readonly id: string
    readonly intentId: string
    readonly attemptId: string
    readonly environment: string
    readonly providerAccountKey: string
    readonly source: IntentProviderEvidence['source']
    readonly sourceEventKey: string
    readonly providerReferenceFingerprint?: string
    readonly status: EvidenceStatus
    readonly trusted: boolean
    readonly observedAt: string
  }) => Effect.Effect<NotificationIntentAggregate, LifecycleError>
  readonly supersede: (input: {
    readonly intentId: string
    readonly now: string
  }) => Effect.Effect<NotificationIntentAggregate, LifecycleError>
  readonly closeExpiredAmbiguity: (input: {
    readonly intentId: string
    readonly now: string
  }) => Effect.Effect<NotificationIntentAggregate, LifecycleError>
}

export class NotificationIntentLifecycle extends Context.Service<
  NotificationIntentLifecycle,
  NotificationIntentLifecycleShape
>()('@b2b-saas-starter/capabilities/notifications/NotificationIntentLifecycle') {}

export type SeedNotificationIntentLifecycleOptions = {
  readonly records?: readonly NotificationIntentAggregate[]
  readonly maxAttemptsPerRoute?: number
  readonly availableMilliEuroByShop?: ReadonlyMap<string, number>
  readonly rateCard?: { readonly id: string; readonly chargeMilliEuro: number }
  readonly eligibilityEvaluator?: ControlledTemplateEligibilityEngineShape['evaluate']
}

const copy = <A>(value: A): A => structuredClone(value)
const id = (prefix: string): string => `${prefix}_${crypto.randomUUID()}`
const milliseconds = (timestamp: string): number => new Date(timestamp).getTime()
const sevenDays = 7 * 24 * 60 * 60 * 1_000
const fiveMinutes = 5 * 60 * 1_000
const oneDay = 24 * 60 * 60 * 1_000

const reject = (
  operation: string,
  reason: NotificationIntentRejected['reason'],
  intentId?: string
) =>
  Effect.fail(
    new NotificationIntentRejected({
      operation,
      reason,
      ...(intentId ? { intentId } : {})
    })
  )

const terminal = (
  intent: NotificationIntentAggregate,
  result: IntentResult,
  reason: string | undefined,
  at: string
) => {
  if (intent.phase === 'terminal') return
  intent.phase = 'terminal'
  intent.result = result
  if (reason) intent.resultReason = reason
  intent.terminalAt = at
  if (intent.reservation?.status === 'active' && result !== 'delivered') {
    intent.reservation.status = 'released'
    intent.reservation.releasedAt = at
    intent.reservation.releaseReason = reason ?? result
  }
}

const activateFallbackOrFail = (
  intent: NotificationIntentAggregate,
  route: DeliveryRoute,
  at: string
) => {
  if (intent.supersededAt) {
    terminal(intent, 'delivery_failed', 'superseded_after_submission', at)
    return
  }
  if (route.channel === 'whatsapp') {
    const sms = intent.routes.find((candidate) => candidate.channel === 'sms')
    if (sms?.state === 'planned') sms.state = 'eligible'
    intent.phase = 'routing'
    return
  }
  terminal(intent, 'delivery_failed', 'all_routes_failed', at)
}

export const applyAcquiredMessagingReservation = (
  intent: NotificationIntentAggregate,
  reservation: {
    readonly id: string
    readonly rateCardId: string
    readonly amountMilliEuro: number
  }
): NotificationIntentAggregate => {
  if (intent.phase === 'terminal') return intent
  intent.reservation = { ...reservation, status: 'active' }
  const whatsapp = intent.routes[0]
  if (whatsapp?.state === 'planned') whatsapp.state = 'eligible'
  intent.phase = 'routing'
  return intent
}

export const recheckRoutesBeforeReservation = (
  intent: NotificationIntentAggregate,
  input: {
    readonly whatsapp: OperationalMessageEligibilityInput
    readonly sms: OperationalMessageEligibilityInput
  },
  evaluateEligibility: ControlledTemplateEligibilityEngineShape['evaluate'],
  now: string
) =>
  Effect.gen(function* () {
    const whatsapp = intent.routes.find((route) => route.channel === 'whatsapp')!
    const sms = intent.routes.find((route) => route.channel === 'sms')!
    const matches = (
      candidate: OperationalMessageEligibilityInput,
      route: DeliveryRoute
    ) =>
      candidate.shopId === intent.shopId &&
      candidate.purpose === intent.purpose &&
      candidate.locale === intent.locale &&
      candidate.channel === route.channel &&
      candidate.provider === route.provider &&
      candidate.destinationFingerprint === intent.recipientSnapshot.fingerprint &&
      candidate.now === now
    if (!matches(input.whatsapp, whatsapp) || !matches(input.sms, sms))
      return yield* reject('begin_routing', 'route_not_eligible', intent.id)

    if (whatsapp.state === 'planned') {
      const result = yield* Effect.result(evaluateEligibility(input.whatsapp))
      if (result._tag === 'Success') whatsapp.state = 'eligible'
      else {
        whatsapp.state = 'ineligible'
        whatsapp.ineligibleReason = 'eligibility_recheck_failed'
        whatsapp.terminalAt = now
        sms.state = 'eligible'
      }
    }
    if (whatsapp.state === 'ineligible') {
      const result = yield* Effect.result(evaluateEligibility(input.sms))
      if (result._tag === 'Failure') {
        sms.state = 'ineligible'
        sms.ineligibleReason = 'eligibility_recheck_failed'
        sms.terminalAt = now
        terminal(intent, 'not_sent', 'no_eligible_route', now)
      } else sms.state = 'eligible'
    }
    return intent
  })

const makeIntent = (
  input: PrepareNotificationIntentInput
): NotificationIntentAggregate => {
  const { manual, ...identity } = input
  return {
    ...identity,
    ...(manual ? { manual } : {}),
    phase:
      milliseconds(input.availableAt) > milliseconds(input.createdAt)
        ? 'scheduled'
        : 'ready',
    supersededAfterSubmission: false,
    routes: [
      {
        id: `drt_${input.id}_whatsapp`,
        ordinal: 0,
        channel: 'whatsapp',
        provider: 'meta',
        state: 'planned',
        attempts: [],
        submissionOutcomes: [],
        evidence: []
      },
      {
        id: `drt_${input.id}_sms`,
        ordinal: 1,
        channel: 'sms',
        provider: 'smso',
        state: 'planned',
        attempts: [],
        submissionOutcomes: [],
        evidence: []
      }
    ],
    reconciliationCases: []
  }
}

export const SeedNotificationIntentLifecycle = (
  options:
    | SeedNotificationIntentLifecycleOptions
    | readonly NotificationIntentAggregate[] = {}
): Layer.Layer<NotificationIntentLifecycle> => {
  const normalized: SeedNotificationIntentLifecycleOptions = Array.isArray(options)
    ? { records: options as readonly NotificationIntentAggregate[] }
    : (options as SeedNotificationIntentLifecycleOptions)
  const records = new Map(
    (normalized.records ?? []).map((record) => [record.id, copy(record)])
  )
  const maxAttempts = normalized.maxAttemptsPerRoute ?? 3
  const balances = new Map(normalized.availableMilliEuroByShop ?? [])
  const rateCard = normalized.rateCard ?? {
    id: 'mrcard_launch_v1',
    chargeMilliEuro: 45
  }
  const evaluateEligibility =
    normalized.eligibilityEvaluator ?? evaluateOperationalMessageEligibility

  const read = (intentId: string, operation: string) => {
    const intent = records.get(intentId)
    return intent
      ? Effect.succeed(intent)
      : reject(operation, 'intent_unavailable', intentId)
  }
  const view = (intent: NotificationIntentAggregate) => copy(intent)

  const service: NotificationIntentLifecycleShape = {
    prepare: (input) => {
      const existing = [...records.values()].find(
        (candidate) => candidate.deduplicationKey === input.deduplicationKey
      )
      if (existing) {
        const sameIdentity =
          existing.shopId === input.shopId &&
          existing.sourceType === input.sourceType &&
          existing.sourceId === input.sourceId &&
          existing.sourceVersion === input.sourceVersion &&
          existing.purpose === input.purpose &&
          existing.recipientRole === input.recipientRole &&
          existing.recipientSnapshot.fingerprint ===
            input.recipientSnapshot.fingerprint &&
          existing.recipientSnapshot.keyVersion === input.recipientSnapshot.keyVersion
        return sameIdentity
          ? Effect.succeed(view(existing))
          : reject('prepare', 'idempotency_conflict', existing.id)
      }
      const intent = makeIntent(input)
      records.set(intent.id, intent)
      return Effect.succeed(view(intent))
    },
    createManual: (input) => {
      const canonicalInput = {
        ...input,
        deduplicationKey: `manual:${input.shopId}:${input.sourceType}:${input.sourceId}:${input.sourceVersion}:${input.manual.commandKey}`
      }
      const existing = [...records.values()].find(
        (candidate) =>
          candidate.shopId === canonicalInput.shopId &&
          candidate.sourceType === canonicalInput.sourceType &&
          candidate.sourceId === canonicalInput.sourceId &&
          candidate.manual?.commandKey === canonicalInput.manual.commandKey
      )
      if (existing) return Effect.succeed(view(existing))
      const createdAt = milliseconds(canonicalInput.createdAt)
      const prior = [...records.values()]
        .filter(
          (candidate) =>
            candidate.shopId === canonicalInput.shopId &&
            candidate.sourceType === canonicalInput.sourceType &&
            candidate.sourceId === canonicalInput.sourceId &&
            candidate.manual &&
            milliseconds(candidate.createdAt) <= createdAt
        )
        .sort(
          (left, right) => milliseconds(right.createdAt) - milliseconds(left.createdAt)
        )
      if (
        (prior[0] && createdAt - milliseconds(prior[0].createdAt) < fiveMinutes) ||
        prior.filter(
          (candidate) => createdAt - milliseconds(candidate.createdAt) < oneDay
        ).length >= 3
      )
        return reject('create_manual', 'manual_rate_limited')
      const intent = makeIntent(canonicalInput)
      records.set(intent.id, intent)
      return Effect.succeed(view(intent))
    },
    findById: (intentId) => Effect.map(read(intentId, 'find_by_id'), view),
    listBySource: (input) =>
      Effect.succeed(
        [...records.values()]
          .filter(
            (intent) =>
              intent.shopId === input.shopId &&
              intent.sourceType === input.sourceType &&
              intent.sourceId === input.sourceId
          )
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
          .map(view)
      ),
    beginRouting: (input) =>
      Effect.flatMap(read(input.intentId, 'begin_routing'), (intent) => {
        if (intent.phase === 'terminal')
          return reject('begin_routing', 'invalid_transition', intent.id)
        if (milliseconds(input.now) < milliseconds(intent.availableAt))
          return reject('begin_routing', 'invalid_transition', intent.id)
        return Effect.flatMap(
          recheckRoutesBeforeReservation(
            intent,
            input.eligibility,
            evaluateEligibility,
            input.now
          ),
          (eligibleIntent) => {
            if (eligibleIntent.phase === 'terminal')
              return Effect.succeed(view(eligibleIntent))
            if (!intent.reservation) {
              const available = balances.get(intent.shopId) ?? 1_000_000
              if (available < rateCard.chargeMilliEuro) {
                terminal(intent, 'not_sent', 'insufficient_balance', input.now)
                return Effect.succeed(view(intent))
              }
              balances.set(intent.shopId, available - rateCard.chargeMilliEuro)
              applyAcquiredMessagingReservation(intent, {
                id: id('mbr'),
                rateCardId: rateCard.id,
                amountMilliEuro: rateCard.chargeMilliEuro
              })
            }
            return Effect.succeed(view(intent))
          }
        )
      }),
    markNotSent: (input) =>
      Effect.flatMap(read(input.intentId, 'mark_not_sent'), (intent) => {
        if (
          intent.phase === 'terminal' &&
          intent.result === 'not_sent' &&
          intent.resultReason === input.reason
        )
          return Effect.succeed(view(intent))
        if (
          intent.phase === 'terminal' ||
          intent.routes.some((route) => route.attempts.length > 0)
        )
          return reject('mark_not_sent', 'invalid_transition', intent.id)
        terminal(intent, 'not_sent', input.reason, input.now)
        return Effect.succeed(view(intent))
      }),
    recordRouteIneligible: (input) =>
      Effect.flatMap(read(input.intentId, 'record_route_ineligible'), (intent) => {
        if (
          intent.phase === 'terminal' ||
          intent.supersededAt ||
          intent.reconciliationCases.some((candidate) => candidate.status === 'open')
        )
          return reject('record_route_ineligible', 'invalid_transition', intent.id)
        const route = intent.routes.find(
          (candidate) => candidate.channel === input.channel
        )
        if (!route)
          return reject('record_route_ineligible', 'route_unavailable', intent.id)
        if (!['planned', 'eligible'].includes(route.state) || route.attempts.length > 0)
          return reject('record_route_ineligible', 'invalid_transition', intent.id)
        route.state = 'ineligible'
        route.ineligibleReason = input.reason
        route.terminalAt = input.now
        if (route.channel === 'whatsapp')
          activateFallbackOrFail(intent, route, input.now)
        else if (
          intent.routes.every((candidate) =>
            ['ineligible', 'terminal_failure'].includes(candidate.state)
          )
        )
          terminal(intent, 'not_sent', 'no_eligible_route', input.now)
        return Effect.succeed(view(intent))
      }),
    prepareSubmission: (input) =>
      Effect.flatMap(
        evaluateEligibility(input.eligibility).pipe(
          Effect.mapError(
            () =>
              new NotificationIntentRejected({
                operation: 'prepare_submission',
                reason: 'route_not_eligible',
                intentId: input.intentId
              })
          )
        ),
        () =>
          Effect.flatMap(read(input.intentId, 'prepare_submission'), (intent) => {
            if (
              intent.phase === 'terminal' ||
              intent.supersededAt ||
              intent.reconciliationCases.some(
                (candidate) => candidate.status === 'open'
              )
            )
              return reject('prepare_submission', 'invalid_transition', intent.id)
            if (!intent.reservation || intent.reservation.status !== 'active')
              return reject('prepare_submission', 'reservation_required', intent.id)
            const route = intent.routes.find(
              (candidate) => candidate.channel === input.channel
            )
            if (!route)
              return reject('prepare_submission', 'route_unavailable', intent.id)
            if (route.state === 'submission_unknown')
              return reject(
                'prepare_submission',
                'submission_unknown_reconciliation_only',
                intent.id
              )
            if (
              input.eligibility.shopId !== intent.shopId ||
              input.eligibility.purpose !== intent.purpose ||
              input.eligibility.locale !== intent.locale ||
              input.eligibility.channel !== route.channel ||
              input.eligibility.provider !== route.provider ||
              input.eligibility.destinationFingerprint !==
                intent.recipientSnapshot.fingerprint ||
              input.eligibility.now !== input.now
            ) {
              return reject('prepare_submission', 'route_not_eligible', intent.id)
            }
            if (route.state !== 'eligible' && route.state !== 'submitting')
              return reject('prepare_submission', 'route_not_eligible', intent.id)
            if (route.state === 'submitting' && route.attempts.length > 0) {
              const lastAttempt = route.attempts.at(-1)!
              const lastOutcome = route.submissionOutcomes.find(
                (candidate) => candidate.attemptId === lastAttempt.id
              )
              if (lastOutcome?.outcome !== 'rejected_retryable')
                return reject('prepare_submission', 'invalid_transition', intent.id)
            }
            if (
              route.retryAvailableAt &&
              milliseconds(input.now) < milliseconds(route.retryAvailableAt)
            )
              return reject('prepare_submission', 'invalid_transition', intent.id)
            if (route.attempts.length >= maxAttempts)
              return reject('prepare_submission', 'retry_limit_reached', intent.id)
            const ordinal = route.attempts.length
            const attempt: SubmissionAttempt = {
              id: `pat_${route.id}_${ordinal}`,
              ordinal,
              idempotencyKey: `${intent.id}:${route.channel}:${ordinal}`,
              requestFingerprint: input.requestFingerprint,
              state: 'submitting',
              startedAt: input.now
            }
            route.attempts.push(attempt)
            route.state = 'submitting'
            intent.phase = 'routing'
            return Effect.succeed({
              intent: view(intent),
              route: copy(route),
              attempt: copy(attempt)
            })
          })
      ),
    recordSubmissionOutcome: (input) =>
      Effect.flatMap(read(input.intentId, 'record_submission_outcome'), (intent) => {
        const route = intent.routes.find((candidate) =>
          candidate.attempts.some((attempt) => attempt.id === input.attemptId)
        )
        const attempt = route?.attempts.find(
          (candidate) => candidate.id === input.attemptId
        )
        if (!route || !attempt)
          return reject('record_submission_outcome', 'attempt_unavailable', intent.id)
        const priorOutcome = route.submissionOutcomes.find(
          (candidate) => candidate.attemptId === input.attemptId
        )
        if (priorOutcome)
          return priorOutcome.outcome === input.outcome
            ? Effect.succeed(view(intent))
            : reject('record_submission_outcome', 'invalid_transition', intent.id)
        route.submissionOutcomes.push({
          attemptId: attempt.id,
          outcome: input.outcome,
          observedAt: input.now
        })
        route.evidence.push({
          id: `pevd_response_${attempt.id}`,
          attemptId: attempt.id,
          environment: input.outcome === 'captured' ? 'local' : input.environment,
          provider: route.provider,
          providerAccountKey:
            input.outcome === 'captured' ? 'console-capture' : input.providerAccountKey,
          source: 'response',
          sourceEventKey:
            input.outcome === 'captured'
              ? `${attempt.id}:captured`
              : input.sourceEventKey,
          ...(input.providerReferenceFingerprint
            ? { providerReferenceFingerprint: input.providerReferenceFingerprint }
            : {}),
          status: input.outcome,
          trusted: input.outcome !== 'captured',
          observedAt: input.now
        })
        if (
          intent.phase === 'terminal' ||
          route.state === 'delivered' ||
          route.state === 'terminal_failure'
        ) {
          const contradictsProjection =
            (route.state === 'delivered' && input.outcome !== 'accepted') ||
            (route.state === 'terminal_failure' &&
              ['accepted', 'submission_unknown'].includes(input.outcome))
          if (contradictsProjection) {
            const sourceIdentity = `response:${attempt.id}:${input.outcome}`
            if (
              !intent.reconciliationCases.some(
                (candidate) => candidate.sourceIdentity === sourceIdentity
              )
            )
              intent.reconciliationCases.push({
                id: id('mrcase'),
                kind: 'contradictory_evidence',
                sourceIdentity,
                openedAt: input.now,
                status: 'open'
              })
          }
          return Effect.succeed(view(intent))
        }
        switch (input.outcome) {
          case 'captured':
            route.state = 'ineligible'
            route.ineligibleReason = 'captured_local'
            route.terminalAt = input.now
            terminal(intent, 'not_sent', 'captured_local', input.now)
            break
          case 'accepted':
            route.state = 'accepted'
            route.acceptedAt = input.now
            intent.phase = 'awaiting_provider'
            break
          case 'rejected_retryable':
            if (route.attempts.length >= maxAttempts) {
              route.state = 'terminal_failure'
              route.terminalAt = input.now
              activateFallbackOrFail(intent, route, input.now)
            } else {
              route.state = 'submitting'
              const delayMs = route.attempts.length === 1 ? 30_000 : 120_000
              route.retryAvailableAt = new Date(
                milliseconds(input.now) + delayMs
              ).toISOString()
            }
            break
          case 'rejected_terminal':
            route.state = 'terminal_failure'
            route.terminalAt = input.now
            activateFallbackOrFail(intent, route, input.now)
            break
          case 'submission_unknown':
            route.state = 'submission_unknown'
            route.terminalAt = input.now
            intent.phase = 'awaiting_provider'
            intent.ambiguitySince = input.now
            break
        }
        return Effect.succeed(view(intent))
      }),
    ingestEvidence: (input) =>
      Effect.flatMap(read(input.intentId, 'ingest_evidence'), (intent) => {
        const route = intent.routes.find((candidate) =>
          candidate.attempts.some((attempt) => attempt.id === input.attemptId)
        )
        if (!route) return reject('ingest_evidence', 'attempt_unavailable', intent.id)
        const duplicate = route.evidence.find(
          (candidate) =>
            (candidate.environment === input.environment &&
              candidate.provider === route.provider &&
              candidate.providerAccountKey === input.providerAccountKey &&
              candidate.source === input.source &&
              candidate.sourceEventKey === input.sourceEventKey) ||
            (Boolean(input.providerReferenceFingerprint) &&
              candidate.environment === input.environment &&
              candidate.provider === route.provider &&
              candidate.providerAccountKey === input.providerAccountKey &&
              candidate.providerReferenceFingerprint ===
                input.providerReferenceFingerprint &&
              candidate.status === input.status)
        )
        if (duplicate) return Effect.succeed(view(intent))
        const trusted =
          input.trusted && !(route.provider === 'smso' && input.source === 'callback')
        const evidence: IntentProviderEvidence = {
          id: input.id,
          attemptId: input.attemptId,
          environment: input.environment,
          provider: route.provider,
          providerAccountKey: input.providerAccountKey,
          source: input.source,
          sourceEventKey: input.sourceEventKey,
          ...(input.providerReferenceFingerprint
            ? { providerReferenceFingerprint: input.providerReferenceFingerprint }
            : {}),
          status: input.status,
          trusted,
          observedAt: input.observedAt
        }
        route.evidence.push(evidence)
        if (!trusted) return Effect.succeed(view(intent))
        const delivered = input.status === 'delivered' || input.status === 'read'
        const contradiction =
          (delivered && route.state === 'terminal_failure') ||
          (input.status === 'terminal_failure' && route.state === 'delivered')
        if (intent.phase === 'terminal' && !contradiction) {
          const conflictsWithTerminal =
            (intent.result === 'delivered' && input.status === 'terminal_failure') ||
            (intent.result !== 'delivered' && delivered)
          if (conflictsWithTerminal) {
            const sourceIdentity = `terminal:${input.environment}:${route.provider}:${input.sourceEventKey}`
            if (
              !intent.reconciliationCases.some(
                (candidate) => candidate.sourceIdentity === sourceIdentity
              )
            )
              intent.reconciliationCases.push({
                id: id('mrcase'),
                kind: 'contradictory_evidence',
                sourceIdentity,
                openedAt: input.observedAt,
                status: 'open'
              })
          }
          return Effect.succeed(view(intent))
        }
        if (contradiction) {
          const sourceIdentity = `${input.environment}:${route.provider}:${input.providerAccountKey}:${input.source}:${input.sourceEventKey}`
          if (
            !intent.reconciliationCases.some(
              (candidate) => candidate.sourceIdentity === sourceIdentity
            )
          )
            intent.reconciliationCases.push({
              id: id('mrcase'),
              kind: 'contradictory_evidence',
              sourceIdentity,
              openedAt: input.observedAt,
              status: 'open'
            })
          return Effect.succeed(view(intent))
        }
        if (intent.resultReason === 'delivery_unconfirmed' && delivered) {
          const sourceIdentity = `late:${input.environment}:${route.provider}:${input.sourceEventKey}`
          if (
            !intent.reconciliationCases.some(
              (candidate) => candidate.sourceIdentity === sourceIdentity
            )
          )
            intent.reconciliationCases.push({
              id: id('mrcase'),
              kind: 'contradictory_evidence',
              sourceIdentity,
              openedAt: input.observedAt,
              status: 'open'
            })
          return Effect.succeed(view(intent))
        }
        if (delivered) {
          if (intent.reservation?.status !== 'active')
            return Effect.succeed(view(intent))
          route.state = 'delivered'
          route.deliveredAt = input.observedAt
          route.terminalAt = input.observedAt
          terminal(intent, 'delivered', undefined, input.observedAt)
          intent.reservation.status = 'converted'
          if (!intent.chargeableDelivery) {
            intent.chargeableDelivery = {
              id: id('mcd'),
              routeId: route.id,
              reservationId: intent.reservation.id,
              rateCardId: intent.reservation.rateCardId,
              chargeMilliEuro: intent.reservation.amountMilliEuro,
              verifiedAt: input.observedAt
            }
          }
        } else if (input.status === 'accepted') {
          if (!['delivered', 'terminal_failure'].includes(route.state)) {
            route.state = 'accepted'
            route.acceptedAt ??= input.observedAt
            intent.phase = 'awaiting_provider'
          }
        } else if (input.status === 'terminal_failure') {
          route.state = 'terminal_failure'
          route.terminalAt = input.observedAt
          activateFallbackOrFail(intent, route, input.observedAt)
        }
        return Effect.succeed(view(intent))
      }),
    supersede: (input) =>
      Effect.flatMap(read(input.intentId, 'supersede'), (intent) => {
        if (intent.supersededAt) return Effect.succeed(view(intent))
        intent.supersededAt = input.now
        const afterSubmission = intent.routes.some((route) => {
          if (['accepted', 'submission_unknown', 'delivered'].includes(route.state))
            return true
          return route.attempts.some((attempt) => {
            const outcome = route.submissionOutcomes.find(
              (candidate) => candidate.attemptId === attempt.id
            )?.outcome
            return !['captured', 'rejected_retryable', 'rejected_terminal'].includes(
              outcome ?? ''
            )
          })
        })
        intent.supersededAfterSubmission = afterSubmission
        if (!afterSubmission) terminal(intent, 'not_sent', 'superseded', input.now)
        return Effect.succeed(view(intent))
      }),
    closeExpiredAmbiguity: (input) =>
      Effect.flatMap(read(input.intentId, 'close_expired_ambiguity'), (intent) => {
        if (
          intent.phase === 'terminal' &&
          intent.result === 'delivery_failed' &&
          intent.resultReason === 'delivery_unconfirmed'
        )
          return Effect.succeed(view(intent))
        if (!intent.ambiguitySince || intent.phase === 'terminal')
          return reject('close_expired_ambiguity', 'invalid_transition', intent.id)
        if (milliseconds(input.now) - milliseconds(intent.ambiguitySince) < sevenDays)
          return reject('close_expired_ambiguity', 'ambiguity_window_active', intent.id)
        terminal(intent, 'delivery_failed', 'delivery_unconfirmed', input.now)
        return Effect.succeed(view(intent))
      })
  }

  return Layer.succeed(NotificationIntentLifecycle)(service)
}
