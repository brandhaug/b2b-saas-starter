import type { D1Database } from '@cloudflare/workers-types'
import { Effect, Layer, Schema } from 'effect'
import { Database } from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import { MessagingFinance } from './messaging-finance.ts'
import {
  ControlledTemplateEligibilityEngine,
  type ControlledTemplateEligibilityEngineShape,
  type OperationalMessageEligibilityInput
} from './controlled-template-eligibility.ts'
import {
  applyAcquiredMessagingReservation,
  NotificationIntentLifecycle,
  NotificationIntentAggregateSchema,
  NotificationIntentRejected,
  recheckRoutesBeforeReservation,
  SeedNotificationIntentLifecycle,
  type NotificationIntentAggregate,
  type NotificationIntentLifecycleShape,
  type PrepareNotificationIntentInput
} from './notification-intent-lifecycle.ts'

type IntentRow = {
  id: string
  payload_json: string
  recipient_json: string
}

type EvidenceRow = {
  id: string
  attempt_id: string
  environment: string
  provider_account_key: string
  source: 'response' | 'callback' | 'query' | 'operator'
  source_event_key: string
  provider_reference_fingerprint: string | null
  status:
    | 'captured'
    | 'accepted'
    | 'rejected_retryable'
    | 'rejected_terminal'
    | 'submission_unknown'
    | 'delivered'
    | 'read'
    | 'terminal_failure'
  trusted: number
  observed_at: string
}

type OutcomeRow = {
  attempt_id: string
  outcome:
    | 'captured'
    | 'accepted'
    | 'rejected_retryable'
    | 'rejected_terminal'
    | 'submission_unknown'
  observed_at: string
}

const unavailable = (cause: unknown) =>
  new CapabilityUnavailable({
    capability: 'notification-intent-lifecycle',
    reason: cause instanceof Error ? cause.message : String(cause)
  })

const tryDb = <A>(run: () => Promise<A>): Effect.Effect<A, CapabilityUnavailable> =>
  Effect.tryPromise({ try: run, catch: unavailable })

const withIntentLease = <A, E, R>(
  raw: D1Database,
  intentId: string,
  effect: (leaseToken: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E | CapabilityUnavailable, R> => {
  const leaseToken = `nil_${crypto.randomUUID()}`
  const ownerId = 'notification-intent-lifecycle'
  return Effect.acquireUseRelease(
    tryDb(async () => {
      for (let retry = 0; retry < 300; retry += 1) {
        const acquiredAt = new Date().toISOString()
        const leasedUntil = new Date(Date.now() + 30_000).toISOString()
        const row = await raw
          .prepare(
            `INSERT INTO notification_intent_leases
             (intent_id, shop_id, owner_id, lease_token, leased_until, attempt_count,
              created_at, updated_at)
             SELECT id, shop_id, ?, ?, ?, 1, ?, ?
             FROM notification_intents WHERE id = ?
             ON CONFLICT(intent_id) DO UPDATE SET
               owner_id = excluded.owner_id,
               lease_token = excluded.lease_token,
               leased_until = excluded.leased_until,
               attempt_count = notification_intent_leases.attempt_count + 1,
               updated_at = excluded.updated_at
             WHERE notification_intent_leases.leased_until <= excluded.created_at
             RETURNING lease_token`
          )
          .bind(ownerId, leaseToken, leasedUntil, acquiredAt, acquiredAt, intentId)
          .first<{ lease_token: string }>()
        if (row?.lease_token === leaseToken) return leaseToken
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      throw new Error(`intent lease busy:${intentId}`)
    }),
    effect,
    (token) =>
      Effect.asVoid(
        tryDb(() =>
          raw
            .prepare(
              `UPDATE notification_intent_leases
               SET leased_until = ?, updated_at = ?
               WHERE intent_id = ? AND lease_token = ?`
            )
            .bind(new Date().toISOString(), new Date().toISOString(), intentId, token)
            .run()
        )
      )
  )
}

const restoreMonotonicTerminalProjection = (
  intent: NotificationIntentAggregate
): NotificationIntentAggregate => {
  const deliveredRoute = intent.routes.find(
    (route) =>
      route.state === 'delivered' &&
      route.evidence.some(
        (evidence) =>
          evidence.trusted &&
          (evidence.status === 'delivered' || evidence.status === 'read')
      )
  )
  if (deliveredRoute?.deliveredAt) {
    intent.phase = 'terminal'
    intent.result = 'delivered'
    intent.terminalAt ??= deliveredRoute.deliveredAt
  }
  return intent
}

const parse = (row: IntentRow): NotificationIntentAggregate | undefined => {
  const payload = JSON.parse(row.payload_json) as {
    readonly operationalMessagingLifecycle?: unknown
  }
  if (payload.operationalMessagingLifecycle === undefined) return undefined
  const recipient = JSON.parse(row.recipient_json) as {
    readonly destination?: {
      readonly ciphertext?: string
      readonly fingerprint?: string
      readonly maskedValue?: string
      readonly countryCode?: string
      readonly keyVersion?: number
    }
  }
  const lifecycle = payload.operationalMessagingLifecycle as Record<string, unknown>
  const destination = recipient.destination
  return restoreMonotonicTerminalProjection(
    Schema.decodeUnknownSync(NotificationIntentAggregateSchema)(
      destination?.ciphertext
        ? {
            ...lifecycle,
            recipientSnapshot: {
              ...destination,
              ciphertext: destination.ciphertext
            }
          }
        : lifecycle
    ) as NotificationIntentAggregate
  )
}

const decodeRow = (row: IntentRow) =>
  Effect.try({ try: () => parse(row), catch: unavailable })

const queryRows = (raw: D1Database, sql: string, ...params: unknown[]) =>
  Effect.map(
    tryDb(() =>
      raw
        .prepare(sql)
        .bind(...params)
        .all<IntentRow>()
    ),
    (result) => result.results
  )

const lifecycleRowsBySource = (
  raw: D1Database,
  input: {
    readonly shopId: string
    readonly sourceType: string
    readonly sourceId: string
  }
) =>
  Effect.flatMap(
    queryRows(
      raw,
      `SELECT id, payload_json, recipient_json FROM notification_intents
       WHERE shop_id = ? AND source_type = ? AND source_id = ?
       ORDER BY created_at, id`,
      input.shopId,
      input.sourceType,
      input.sourceId
    ),
    (rows) =>
      Effect.map(Effect.all(rows.map(decodeRow)), (decoded) =>
        decoded.flatMap((intent) => (intent ? [intent] : []))
      )
  )

const lifecycleRowById = (raw: D1Database, intentId: string) =>
  Effect.flatMap(
    tryDb(() =>
      raw
        .prepare(
          'SELECT id, payload_json, recipient_json FROM notification_intents WHERE id = ? LIMIT 1'
        )
        .bind(intentId)
        .first<IntentRow>()
    ),
    (row) =>
      Effect.flatMap(row ? decodeRow(row) : Effect.succeed(undefined), (intent) =>
        intent
          ? Effect.flatMap(
              Effect.all([
                tryDb(() =>
                  raw
                    .prepare(
                      `SELECT id, attempt_id, environment, provider_account_key, source,
                          source_event_key, provider_reference_fingerprint, status,
                          trusted, observed_at
                   FROM provider_evidence
                   WHERE intent_id = ?
                   ORDER BY observed_at, id`
                    )
                    .bind(intentId)
                    .all<EvidenceRow>()
                ),
                tryDb(() =>
                  raw
                    .prepare(
                      `SELECT attempt_id, outcome, observed_at
                       FROM submission_outcomes
                       WHERE intent_id = ?
                       ORDER BY observed_at, id`
                    )
                    .bind(intentId)
                    .all<OutcomeRow>()
                )
              ]),
              ([evidenceRows, outcomeRows]) =>
                runSeed(
                  [intent],
                  Effect.gen(function* () {
                    const seed = yield* NotificationIntentLifecycle
                    let hydrated = intent
                    for (const outcome of outcomeRows.results) {
                      const responseEvidence = evidenceRows.results.find(
                        (evidence) =>
                          evidence.attempt_id === outcome.attempt_id &&
                          evidence.source === 'response'
                      )
                      hydrated = yield* seed.recordSubmissionOutcome({
                        intentId,
                        attemptId: outcome.attempt_id,
                        outcome: outcome.outcome,
                        ...(outcome.outcome !== 'captured' && responseEvidence
                          ? {
                              environment: responseEvidence.environment,
                              providerAccountKey: responseEvidence.provider_account_key,
                              sourceEventKey: responseEvidence.source_event_key,
                              ...(responseEvidence.provider_reference_fingerprint
                                ? {
                                    providerReferenceFingerprint:
                                      responseEvidence.provider_reference_fingerprint
                                  }
                                : {})
                            }
                          : {}),
                        now: outcome.observed_at
                      } as Parameters<
                        NotificationIntentLifecycleShape['recordSubmissionOutcome']
                      >[0])
                    }
                    for (const evidence of evidenceRows.results) {
                      hydrated = yield* seed.ingestEvidence({
                        id: evidence.id,
                        intentId,
                        attemptId: evidence.attempt_id,
                        environment: evidence.environment,
                        providerAccountKey: evidence.provider_account_key,
                        source: evidence.source,
                        sourceEventKey: evidence.source_event_key,
                        ...(evidence.provider_reference_fingerprint
                          ? {
                              providerReferenceFingerprint:
                                evidence.provider_reference_fingerprint
                            }
                          : {}),
                        status: evidence.status,
                        trusted: evidence.trusted === 1,
                        observedAt: evidence.observed_at
                      })
                    }
                    return hydrated
                  })
                )
            )
          : Effect.fail(
              new NotificationIntentRejected({
                operation: 'find_by_id',
                reason: 'intent_unavailable',
                intentId
              })
            )
      )
  )

const lifecycleRowByDeduplicationKey = (raw: D1Database, key: string) =>
  Effect.flatMap(
    tryDb(() =>
      raw
        .prepare(
          'SELECT id, payload_json, recipient_json FROM notification_intents WHERE deduplication_key = ? LIMIT 1'
        )
        .bind(key)
        .first<IntentRow>()
    ),
    (row) => (row ? decodeRow(row) : Effect.succeed(undefined))
  )

type MerchantControlRow = {
  enabled: number
  frozen: number
  confirmation_enabled: number
  reminder_enabled: number
  cancellation_enabled: number
  reschedule_enabled: number
}

type SuppressionRow = {
  shop_id: string | null
  destination_fingerprint: string
  scope: 'all_operational' | 'whatsapp' | 'sms'
  effective_at: string
  expires_at: string | null
  revoked_at: string | null
}

const refreshAuthoritativeEligibility = (
  raw: D1Database,
  input: OperationalMessageEligibilityInput,
  environment: string
) =>
  Effect.map(
    Effect.all([
      tryDb(() =>
        raw
          .prepare(
            `SELECT enabled, frozen, confirmation_enabled, reminder_enabled,
                    cancellation_enabled, reschedule_enabled
             FROM merchant_messaging_controls WHERE shop_id = ? LIMIT 1`
          )
          .bind(input.shopId)
          .first<MerchantControlRow>()
      ),
      tryDb(() =>
        raw
          .prepare(
            `SELECT shop_id, destination_fingerprint, scope, effective_at,
                    expires_at, revoked_at
             FROM suppression_directives
             WHERE destination_fingerprint = ? AND (shop_id IS NULL OR shop_id = ?)`
          )
          .bind(input.destinationFingerprint, input.shopId)
          .all<SuppressionRow>()
      ),
      tryDb(() =>
        raw
          .prepare(
            `SELECT MIN(enabled) AS enabled
             FROM messaging_channel_controls
             WHERE environment = ? AND channel = ? AND provider = ?`
          )
          .bind(environment, input.channel, input.provider)
          .first<{ enabled: number | null }>()
      )
    ]),
    ([merchant, suppressions, channel]) => {
      const purposeEnabled = merchant
        ? {
            appointment_confirmation: merchant.confirmation_enabled,
            appointment_reminder: merchant.reminder_enabled,
            appointment_cancellation: merchant.cancellation_enabled,
            appointment_reschedule: merchant.reschedule_enabled
          }[input.purpose] === 1
        : false
      return {
        ...input,
        suppressions: suppressions.results.map((directive) => ({
          shopId: directive.shop_id,
          destinationFingerprint: directive.destination_fingerprint,
          scope: directive.scope,
          effectiveAt: directive.effective_at,
          ...(directive.expires_at ? { expiresAt: directive.expires_at } : {}),
          ...(directive.revoked_at ? { revokedAt: directive.revoked_at } : {})
        })),
        controls: {
          ...input.controls,
          merchantEnabled: merchant?.enabled === 1,
          merchantFrozen: merchant?.frozen === 1,
          purposeEnabled,
          channelEnabled: channel?.enabled === 1
        }
      } satisfies OperationalMessageEligibilityInput
    }
  )

const statusFor = (intent: NotificationIntentAggregate) => {
  if (intent.phase !== 'terminal')
    return intent.phase === 'scheduled' || intent.phase === 'ready'
      ? 'pending'
      : 'processing'
  if (intent.result === 'delivered') return 'delivered'
  if (intent.result === 'not_sent') return 'cancelled'
  return 'failed'
}

const lifecyclePayload = (intent: NotificationIntentAggregate) => {
  const { recipientSnapshot: _, ...safeLifecycle } = intent
  return JSON.stringify({ operationalMessagingLifecycle: safeLifecycle })
}

const recipientPayload = (intent: NotificationIntentAggregate) =>
  JSON.stringify({
    role: intent.recipientRole,
    destination: {
      ciphertext: intent.recipientSnapshot.ciphertext,
      fingerprint: intent.recipientSnapshot.fingerprint,
      maskedValue: intent.recipientSnapshot.maskedValue,
      countryCode: intent.recipientSnapshot.countryCode,
      keyVersion: intent.recipientSnapshot.keyVersion
    }
  })

const lastChangedAt = (intent: NotificationIntentAggregate): string => {
  const candidates = [
    intent.createdAt,
    intent.terminalAt,
    intent.supersededAt,
    ...intent.routes.flatMap((route) => [
      route.acceptedAt,
      route.deliveredAt,
      route.terminalAt,
      route.retryAvailableAt,
      ...route.attempts.map((attempt) => attempt.startedAt),
      ...route.submissionOutcomes.map((outcome) => outcome.observedAt),
      ...route.evidence.map((evidence) => evidence.observedAt)
    ])
  ].filter((value): value is string => Boolean(value))
  return candidates.sort().at(-1) ?? intent.createdAt
}

const persist = (
  raw: D1Database,
  intent: NotificationIntentAggregate,
  leaseToken: string
) =>
  tryDb(async () => {
    const changedAt = lastChangedAt(intent)
    const payload = lifecyclePayload(intent)
    const statements = [
      raw
        .prepare(
          `INSERT INTO notification_intent_leases
           (intent_id, shop_id, owner_id, lease_token, leased_until, attempt_count,
            created_at, updated_at)
           SELECT notification_intents.id, notification_intents.shop_id,
                  'stale-writer-fence', ?, ?, 0, ?, ?
           FROM notification_intents
           WHERE notification_intents.id = ?
             AND NOT EXISTS (
               SELECT 1 FROM notification_intent_leases
               WHERE intent_id = ? AND lease_token = ?
             )`
        )
        .bind(
          `fence_${crypto.randomUUID()}`,
          changedAt,
          changedAt,
          changedAt,
          intent.id,
          intent.id,
          leaseToken
        ),
      raw
        .prepare(
          `UPDATE notification_intents
           SET payload_json = ?,
               phase = CASE WHEN phase = 'terminal' THEN phase ELSE ? END,
               result = COALESCE(result, ?),
               result_reason = COALESCE(result_reason, ?),
               terminal_at = COALESCE(terminal_at, ?),
               superseded_at = COALESCE(superseded_at, ?),
               superseded_after_submission = MAX(superseded_after_submission, ?),
               status = CASE WHEN phase = 'terminal' THEN status ELSE ? END,
               updated_at = MAX(updated_at, ?)
           WHERE id = ? AND shop_id = ?
             AND EXISTS (
               SELECT 1 FROM notification_intent_leases
               WHERE intent_id = ? AND lease_token = ?
             )`
        )
        .bind(
          payload,
          intent.phase,
          intent.result ?? null,
          intent.resultReason ?? null,
          intent.terminalAt ?? null,
          intent.supersededAt ?? null,
          intent.supersededAfterSubmission ? 1 : 0,
          statusFor(intent),
          changedAt,
          intent.id,
          intent.shopId,
          intent.id,
          leaseToken
        )
    ]
    for (const route of intent.routes) {
      statements.push(
        raw
          .prepare(
            `INSERT INTO delivery_routes
             (id, shop_id, intent_id, ordinal, channel, provider, state, ineligible_reason,
              accepted_at, delivered_at, terminal_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               state = CASE
                 WHEN delivery_routes.state = 'delivered' THEN delivery_routes.state
                 WHEN delivery_routes.state = 'terminal_failure'
                   AND excluded.state = 'delivered' THEN delivery_routes.state
                 WHEN delivery_routes.state = 'submission_unknown'
                   AND excluded.state IN ('planned', 'eligible', 'submitting', 'accepted')
                   THEN delivery_routes.state
                 ELSE excluded.state
               END,
               ineligible_reason = COALESCE(delivery_routes.ineligible_reason, excluded.ineligible_reason),
               accepted_at = COALESCE(delivery_routes.accepted_at, excluded.accepted_at),
               delivered_at = COALESCE(delivery_routes.delivered_at, excluded.delivered_at),
               terminal_at = COALESCE(delivery_routes.terminal_at, excluded.terminal_at),
               updated_at = excluded.updated_at`
          )
          .bind(
            route.id,
            intent.shopId,
            intent.id,
            route.ordinal,
            route.channel,
            route.provider,
            route.state,
            route.ineligibleReason ?? null,
            route.acceptedAt ?? null,
            route.deliveredAt ?? null,
            route.terminalAt ?? null,
            intent.createdAt,
            changedAt
          )
      )
      for (const attempt of route.attempts) {
        statements.push(
          raw
            .prepare(
              `INSERT OR IGNORE INTO submission_attempts
               (id, shop_id, intent_id, route_id, ordinal, idempotency_key,
                request_fingerprint, state, started_at, completed_at, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
            )
            .bind(
              attempt.id,
              intent.shopId,
              intent.id,
              route.id,
              attempt.ordinal,
              attempt.idempotencyKey,
              attempt.requestFingerprint,
              attempt.state,
              attempt.startedAt,
              attempt.startedAt
            )
        )
      }
      for (const outcome of route.submissionOutcomes) {
        statements.push(
          raw
            .prepare(
              `INSERT OR IGNORE INTO submission_outcomes
               (id, shop_id, intent_id, route_id, attempt_id, outcome, observed_at, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(
              `pso_${outcome.attemptId}`,
              intent.shopId,
              intent.id,
              route.id,
              outcome.attemptId,
              outcome.outcome,
              outcome.observedAt,
              outcome.observedAt
            )
        )
      }
      for (const evidence of route.evidence) {
        statements.push(
          raw
            .prepare(
              `INSERT OR IGNORE INTO provider_evidence
               (id, shop_id, intent_id, route_id, attempt_id, environment, provider,
                provider_account_key, source, source_event_key, provider_reference_fingerprint,
                status, trusted, observed_at, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(
              evidence.id,
              intent.shopId,
              intent.id,
              route.id,
              evidence.attemptId,
              evidence.environment,
              evidence.provider,
              evidence.providerAccountKey,
              evidence.source,
              evidence.sourceEventKey,
              evidence.providerReferenceFingerprint ?? null,
              evidence.status,
              evidence.trusted ? 1 : 0,
              evidence.observedAt,
              evidence.observedAt
            )
        )
      }
    }
    for (const reconciliationCase of intent.reconciliationCases) {
      statements.push(
        raw
          .prepare(
            `INSERT OR IGNORE INTO messaging_reconciliation_cases
             (id, shop_id, intent_id, kind, source_identity, status, severity, safe_summary,
              opened_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'open', 'high', 'Delivery evidence needs review', ?, ?, ?)`
          )
          .bind(
            reconciliationCase.id,
            intent.shopId,
            intent.id,
            reconciliationCase.kind,
            reconciliationCase.sourceIdentity,
            reconciliationCase.openedAt,
            reconciliationCase.openedAt,
            reconciliationCase.openedAt
          )
      )
    }
    await raw.batch(statements)
    return intent
  })

const insertPrepared = (
  raw: D1Database,
  intent: NotificationIntentAggregate,
  enforceManualLimits = false
) =>
  tryDb(async () => {
    const payload = lifecyclePayload(intent)
    const recipient = recipientPayload(intent)
    const insertSql = enforceManualLimits
      ? `INSERT OR IGNORE INTO notification_intents
           (id, shop_id, topic, recipient_json, payload_json, source_type, source_id,
            source_version, deduplication_key, purpose, phase, locale, status, available_at,
            created_at, updated_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           WHERE NOT EXISTS (
             SELECT 1 FROM notification_intents
             WHERE shop_id = ? AND source_type = ? AND source_id = ?
               AND json_extract(payload_json, '$.operationalMessagingLifecycle.manual.commandKey') IS NOT NULL
               AND created_at > ? AND created_at <= ?
           )
           AND (
             SELECT COUNT(*) FROM notification_intents
             WHERE shop_id = ? AND source_type = ? AND source_id = ?
               AND json_extract(payload_json, '$.operationalMessagingLifecycle.manual.commandKey') IS NOT NULL
               AND created_at > ? AND created_at <= ?
           ) < 3`
      : `INSERT OR IGNORE INTO notification_intents
           (id, shop_id, topic, recipient_json, payload_json, source_type, source_id,
            source_version, deduplication_key, purpose, phase, locale, status, available_at,
            created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    const insertParams: unknown[] = [
      intent.id,
      intent.shopId,
      intent.topic,
      recipient,
      payload,
      intent.sourceType,
      intent.sourceId,
      intent.sourceVersion,
      intent.deduplicationKey,
      intent.purpose,
      intent.phase,
      intent.locale,
      statusFor(intent),
      intent.availableAt,
      intent.createdAt,
      intent.createdAt
    ]
    if (enforceManualLimits) {
      const createdAt = new Date(intent.createdAt).getTime()
      insertParams.push(
        intent.shopId,
        intent.sourceType,
        intent.sourceId,
        new Date(createdAt - 5 * 60 * 1_000).toISOString(),
        intent.createdAt,
        intent.shopId,
        intent.sourceType,
        intent.sourceId,
        new Date(createdAt - 24 * 60 * 60 * 1_000).toISOString(),
        intent.createdAt
      )
    }
    await raw.batch([
      raw.prepare(insertSql).bind(...insertParams),
      ...intent.routes.map((route) =>
        raw
          .prepare(
            `INSERT OR IGNORE INTO delivery_routes
             (id, shop_id, intent_id, ordinal, channel, provider, state, created_at, updated_at)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
             WHERE EXISTS (SELECT 1 FROM notification_intents WHERE id = ?)`
          )
          .bind(
            route.id,
            intent.shopId,
            intent.id,
            route.ordinal,
            route.channel,
            route.provider,
            route.state,
            intent.createdAt,
            intent.createdAt,
            intent.id
          )
      )
    ])
    return intent
  })

const runSeed = <A, E>(
  records: readonly NotificationIntentAggregate[],
  effect: Effect.Effect<A, E, NotificationIntentLifecycle>,
  eligibilityEvaluator?: ControlledTemplateEligibilityEngineShape['evaluate']
) =>
  Effect.provide(
    effect,
    SeedNotificationIntentLifecycle({
      records,
      ...(eligibilityEvaluator
        ? {
            eligibilityEvaluator
          }
        : {})
    })
  )

export const LiveNotificationIntentLifecycle: Layer.Layer<
  NotificationIntentLifecycle,
  never,
  Database | MessagingFinance | ControlledTemplateEligibilityEngine
> = Layer.effect(
  NotificationIntentLifecycle,
  Effect.gen(function* () {
    const db = yield* Database
    const finance = yield* MessagingFinance
    const eligibility = yield* ControlledTemplateEligibilityEngine
    const raw = db.$client.config.db
    const financeEffect = <A, E>(effect: Effect.Effect<A, E>) =>
      Effect.mapError(effect, (error) =>
        error instanceof CapabilityUnavailable ? error : unavailable(error)
      )

    const recoverFinancialDecision = (intent: NotificationIntentAggregate) => {
      const deliveredRoute = intent.routes.find((route) => route.state === 'delivered')
      if (
        deliveredRoute?.deliveredAt &&
        intent.reservation?.status === 'active' &&
        !intent.chargeableDelivery &&
        !intent.reconciliationCases.some((candidate) => candidate.status === 'open')
      ) {
        intent.phase = 'terminal'
        intent.result = 'delivered'
        intent.terminalAt = deliveredRoute.deliveredAt
        intent.reservation.status = 'converted'
        intent.chargeableDelivery = {
          id: `mcd_${intent.id}`,
          routeId: deliveredRoute.id,
          reservationId: intent.reservation.id,
          rateCardId: intent.reservation.rateCardId,
          chargeMilliEuro: intent.reservation.amountMilliEuro,
          verifiedAt: deliveredRoute.deliveredAt
        }
      }
      return intent
    }

    const stagedBeforeFinance = (intent: NotificationIntentAggregate) => {
      const staged = structuredClone(intent)
      staged.phase = staged.routes.some((route) => route.attempts.length > 0)
        ? 'awaiting_provider'
        : 'ready'
      delete staged.result
      delete staged.resultReason
      delete staged.terminalAt
      delete staged.chargeableDelivery
      if (staged.reservation) {
        staged.reservation.status = 'active'
        delete staged.reservation.releasedAt
        delete staged.reservation.releaseReason
      }
      return staged
    }

    const settle = (rawIntent: NotificationIntentAggregate, leaseToken: string) =>
      Effect.gen(function* () {
        const intent = recoverFinancialDecision(rawIntent)
        if (intent.chargeableDelivery) {
          yield* persist(raw, stagedBeforeFinance(intent), leaseToken)
          const delivery = yield* financeEffect(
            finance.convertDelivery({
              shopId: intent.shopId,
              intentId: intent.id,
              routeId: intent.chargeableDelivery.routeId,
              verifiedAt: intent.chargeableDelivery.verifiedAt
            })
          )
          intent.chargeableDelivery = {
            id: delivery.id,
            routeId: delivery.routeId,
            reservationId: delivery.reservationId,
            rateCardId: delivery.rateCardId,
            chargeMilliEuro: delivery.chargeMilliEuro,
            verifiedAt: delivery.verifiedAt
          }
          yield* persist(raw, intent, leaseToken)
        } else if (intent.reservation?.status === 'released') {
          // Release is idempotent. Persisting the terminal decision first lets the
          // next leased pass retry finance if the external step fails.
          yield* persist(raw, intent, leaseToken)
          yield* financeEffect(
            finance.release({
              shopId: intent.shopId,
              intentId: intent.id,
              reason: intent.reservation.releaseReason ?? 'terminal_without_delivery',
              releasedAt: intent.reservation.releasedAt ?? lastChangedAt(intent)
            })
          )
        } else {
          yield* persist(raw, intent, leaseToken)
        }
        return intent
      })

    const mutate = <A extends NotificationIntentAggregate>(
      intentId: string,
      operation: (
        service: NotificationIntentLifecycleShape
      ) => Effect.Effect<A, NotificationIntentRejected | CapabilityUnavailable>
    ) =>
      withIntentLease(raw, intentId, (leaseToken) =>
        Effect.gen(function* () {
          const current = yield* lifecycleRowById(raw, intentId)
          if (
            current.phase === 'terminal' &&
            current.reservation?.status === 'released'
          )
            yield* settle(current, leaseToken)
          const next = yield* runSeed(
            [current],
            Effect.flatMap(NotificationIntentLifecycle, operation)
          )
          return yield* settle(next, leaseToken)
        })
      )

    const prepare = (input: PrepareNotificationIntentInput) =>
      Effect.gen(function* () {
        const existing = yield* lifecycleRowByDeduplicationKey(
          raw,
          input.deduplicationKey
        )
        if (existing) {
          return yield* runSeed(
            [existing],
            Effect.flatMap(NotificationIntentLifecycle, (service) =>
              service.prepare(input)
            )
          )
        }
        const prepared = yield* runSeed(
          [],
          Effect.flatMap(NotificationIntentLifecycle, (service) =>
            service.prepare(input)
          )
        )
        yield* insertPrepared(raw, prepared)
        const committed = yield* lifecycleRowByDeduplicationKey(
          raw,
          input.deduplicationKey
        )
        if (!committed)
          return yield* new CapabilityUnavailable({
            capability: 'notification-intent-lifecycle',
            reason: 'prepared intent was not committed'
          })
        return committed
      })

    const service: NotificationIntentLifecycleShape = {
      prepare,
      createManual: (input) =>
        Effect.gen(function* () {
          const current = yield* lifecycleRowsBySource(raw, input)
          const prepared = yield* runSeed(
            current,
            Effect.flatMap(NotificationIntentLifecycle, (seed) =>
              seed.createManual(input)
            )
          )
          if (current.some((candidate) => candidate.id === prepared.id)) return prepared
          yield* insertPrepared(raw, prepared, true)
          const committed = yield* lifecycleRowByDeduplicationKey(
            raw,
            prepared.deduplicationKey
          )
          if (!committed)
            return yield* new NotificationIntentRejected({
              operation: 'create_manual',
              reason: 'manual_rate_limited'
            })
          return committed
        }),
      findById: (intentId) => lifecycleRowById(raw, intentId),
      listBySource: (input) => lifecycleRowsBySource(raw, input),
      beginRouting: (input) =>
        withIntentLease(raw, input.intentId, (leaseToken) =>
          Effect.gen(function* () {
            const current = yield* lifecycleRowById(raw, input.intentId)
            if (
              current.phase === 'terminal' ||
              Date.parse(input.now) < Date.parse(current.availableAt)
            )
              return yield* new NotificationIntentRejected({
                operation: 'begin_routing',
                reason: 'invalid_transition',
                intentId: current.id
              })
            if (current.reservation?.status === 'active') return current
            const authoritativeEligibility = {
              whatsapp: yield* refreshAuthoritativeEligibility(
                raw,
                input.eligibility.whatsapp,
                input.environment
              ),
              sms: yield* refreshAuthoritativeEligibility(
                raw,
                input.eligibility.sms,
                input.environment
              )
            }
            const eligibleIntent = yield* recheckRoutesBeforeReservation(
              current,
              authoritativeEligibility,
              eligibility.evaluate,
              input.now
            )
            if (eligibleIntent.phase === 'terminal') {
              yield* persist(raw, eligibleIntent, leaseToken)
              return eligibleIntent
            }
            const expiresAt =
              input.expiresAt ??
              new Date(
                new Date(input.now).getTime() + 7 * 24 * 60 * 60 * 1_000
              ).toISOString()
            const reservation = yield* Effect.catchTag(
              finance.reserve({
                shopId: current.shopId,
                intentId: current.id,
                expiresAt,
                reservedAt: input.now
              }),
              'MessagingFinanceRejected',
              (error) =>
                error.reason === 'insufficient_balance'
                  ? Effect.succeed(null)
                  : Effect.fail(
                      unavailable(`reserve:${error.operation}:${error.reason}`)
                    )
            )
            if (!reservation) {
              const next = yield* runSeed(
                [current],
                Effect.flatMap(NotificationIntentLifecycle, (seed) =>
                  seed.markNotSent({
                    intentId: current.id,
                    reason: 'insufficient_balance',
                    now: input.now
                  })
                )
              )
              yield* persist(raw, next, leaseToken)
              return next
            }
            const next = applyAcquiredMessagingReservation(current, {
              id: reservation.id,
              rateCardId: reservation.rateCardId,
              amountMilliEuro: reservation.amountMilliEuro
            })
            yield* persist(raw, next, leaseToken)
            return next
          })
        ),
      markNotSent: (input) => mutate(input.intentId, (seed) => seed.markNotSent(input)),
      recordRouteIneligible: (input) =>
        mutate(input.intentId, (seed) => seed.recordRouteIneligible(input)),
      prepareSubmission: (input) =>
        withIntentLease(raw, input.intentId, (leaseToken) =>
          Effect.gen(function* () {
            const current = yield* lifecycleRowById(raw, input.intentId)
            const authoritativeInput = {
              ...input,
              eligibility: yield* refreshAuthoritativeEligibility(
                raw,
                input.eligibility,
                input.environment
              )
            }
            const result = yield* runSeed(
              [current],
              Effect.flatMap(NotificationIntentLifecycle, (seed) =>
                seed.prepareSubmission(authoritativeInput)
              ),
              eligibility.evaluate
            )
            yield* settle(result.intent, leaseToken)
            return result
          })
        ),
      recordSubmissionOutcome: (input) =>
        mutate(input.intentId, (seed) => seed.recordSubmissionOutcome(input)),
      ingestEvidence: (input) =>
        mutate(input.intentId, (seed) => seed.ingestEvidence(input)),
      supersede: (input) => mutate(input.intentId, (seed) => seed.supersede(input)),
      closeExpiredAmbiguity: (input) =>
        mutate(input.intentId, (seed) => seed.closeExpiredAmbiguity(input))
    }
    return service
  })
)
