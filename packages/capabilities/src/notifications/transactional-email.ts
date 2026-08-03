import { Context, Effect, Layer, Schema } from 'effect'
import { and, desc, eq, lt, sql } from 'drizzle-orm'
import {
  Database,
  merchantMemberships,
  rawD1FromDatabase,
  transactionalEmailCallbackReceipts,
  transactionalEmailEvidence as emailEvidenceTable,
  user
} from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import {
  selectTransactionalEmailProvider,
  type EmailProviderCallback,
  type TransactionalEmailLocale,
  type TransactionalEmailProvider,
  type TransactionalEmailRuntime
} from './transactional-email-provider.ts'
import {
  evidenceFromSubmission,
  maskEmail,
  normalizeOwnerEmail,
  ownerActivationTemplates,
  readinessFromEvidence,
  submissionPersistence
} from './transactional-email-policy.ts'

export {
  makeConfiguredTransactionalEmailProvider,
  selectTransactionalEmailProvider
} from './transactional-email-provider.ts'
export type {
  EmailProviderCallback,
  EmailProviderSubmission,
  TransactionalEmailLocale,
  TransactionalEmailProvider,
  TransactionalEmailProviderState,
  TransactionalEmailRuntime
} from './transactional-email-provider.ts'

export const TransactionalEmailEvidence = Schema.Struct({
  evidenceId: Schema.String,
  merchantId: Schema.String,
  status: Schema.Literals([
    'submitting',
    'captured',
    'accepted',
    'delivered',
    'failed',
    'submission_unknown'
  ]),
  locale: Schema.Literals(['ro', 'en']),
  templateKey: Schema.String,
  maskedDestination: Schema.String,
  attemptedAt: Schema.String,
  attemptCount: Schema.Int,
  retryable: Schema.Boolean,
  acceptedAt: Schema.optional(Schema.String),
  deliveredAt: Schema.optional(Schema.String),
  failureCode: Schema.optional(Schema.String)
})
export type TransactionalEmailEvidence = typeof TransactionalEmailEvidence.Type

export const canReuseOwnerActivationTestCommand = (
  evidence: Pick<TransactionalEmailEvidence, 'retryable' | 'status'>
) => evidence.retryable || evidence.status === 'submitting'

const ownerActivationTestPrefix = (merchantId: string) =>
  `owner-activation-test:${merchantId}:`

export const ownerActivationTestIdempotencyKey = (
  merchantId: string,
  commandId: string
) => `${ownerActivationTestPrefix(merchantId)}${commandId}`

const ownerActivationTestCommandId = (merchantId: string, idempotencyKey: string) => {
  const prefix = ownerActivationTestPrefix(merchantId)
  if (!idempotencyKey.startsWith(prefix)) return null
  const commandId = idempotencyKey.slice(prefix.length)
  return commandId || null
}

export type OwnerActivationTestAttemptRecord = {
  readonly commandId: string
  readonly evidence: TransactionalEmailEvidence
}

const ownerActivationTestAttemptRecord = (
  merchantId: string,
  idempotencyKey: string,
  evidence: TransactionalEmailEvidence
): OwnerActivationTestAttemptRecord | null => {
  const commandId = ownerActivationTestCommandId(merchantId, idempotencyKey)
  return commandId ? { commandId, evidence } : null
}

const submissionLeaseMs = 60_000
const submissionLeaseCutoff = (now: string) =>
  new Date(Date.parse(now) - submissionLeaseMs).toISOString()

export const NotificationReadiness = Schema.Struct({
  merchantId: Schema.String,
  state: Schema.Literals([
    'ready',
    'not_tested',
    'needs_configuration',
    'disabled',
    'failed'
  ]),
  acceptedEvidenceId: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String)
})
export type NotificationReadiness = typeof NotificationReadiness.Type

export class TransactionalEmailRejected extends Schema.TaggedErrorClass<TransactionalEmailRejected>()(
  'TransactionalEmailRejected',
  {
    reason: Schema.Literals([
      'owner_email_not_verified',
      'invalid_destination',
      'idempotency_key_conflict',
      'needs_configuration',
      'disabled'
    ])
  }
) {}

export class TransactionalEmailCallbackRejected extends Schema.TaggedErrorClass<TransactionalEmailCallbackRejected>()(
  'TransactionalEmailCallbackRejected',
  { code: Schema.String }
) {}

export type SendOwnerActivationTest = {
  readonly merchantId: string
  readonly ownerUserId: string
  readonly verifiedOwnerEmail: string | null
  readonly locale: TransactionalEmailLocale
  readonly idempotencyKey: string
  readonly now: string
}

export type TransactionalEmailShape = {
  readonly sendOwnerActivationTest: (
    input: SendOwnerActivationTest
  ) => Effect.Effect<
    TransactionalEmailEvidence,
    TransactionalEmailRejected | CapabilityUnavailable
  >
  readonly readiness: (
    merchantId: string
  ) => Effect.Effect<NotificationReadiness, CapabilityUnavailable>
  readonly ownerActivationTestAttempt: (input: {
    readonly merchantId: string
    readonly now: string
  }) => Effect.Effect<OwnerActivationTestAttemptRecord | null, CapabilityUnavailable>
  readonly receiveCallback: (input: {
    readonly rawBody: string
    readonly signature: string
    readonly timestamp: string
    readonly now: string
  }) => Effect.Effect<
    'applied' | 'duplicate' | 'ignored' | 'out_of_order' | 'pending',
    CapabilityUnavailable | TransactionalEmailCallbackRejected
  >
}

export class TransactionalEmail extends Context.Service<
  TransactionalEmail,
  TransactionalEmailShape
>()('@b2b-saas-starter/capabilities/notifications/TransactionalEmail') {}

export const makeSeedTransactionalEmailLayer = (input: {
  readonly runtime: TransactionalEmailRuntime
  readonly provider?: TransactionalEmailProvider
  readonly disabled?: boolean
}): Layer.Layer<TransactionalEmail> => {
  const provider = selectTransactionalEmailProvider(input)
  const evidenceByIdempotency = new Map<string, TransactionalEmailEvidence>()
  const commandSignatures = new Map<string, string>()
  const evidenceByProviderId = new Map<string, TransactionalEmailEvidence>()
  const attemptOrderByIdempotency = new Map<string, number>()
  let latestAttemptOrder = 0
  const callbackEvents = new Set<string>()
  const latestProviderOccurrence = new Map<string, string>()
  const pendingCallbacks = new Map<
    string,
    readonly Extract<EmailProviderCallback, { readonly _tag: 'verified' }>[]
  >()

  const configurationReadiness = (merchantId: string): NotificationReadiness =>
    readinessFromEvidence(merchantId, provider.state)

  const applySeedCallback = (
    callback: Extract<EmailProviderCallback, { readonly _tag: 'verified' }>
  ) => {
    const existing = evidenceByProviderId.get(callback.providerReferenceFingerprint)
    if (!existing) return 'ignored' as const
    const latest = latestProviderOccurrence.get(existing.evidenceId)
    if (
      (latest && latest >= callback.occurredAt) ||
      existing.status === 'delivered' ||
      existing.status === 'failed'
    )
      return 'out_of_order' as const
    const updated: TransactionalEmailEvidence =
      callback.status === 'delivered'
        ? {
            ...existing,
            status: 'delivered',
            deliveredAt: callback.occurredAt,
            retryable: false
          }
        : {
            ...existing,
            status: 'failed',
            failureCode: callback.code ?? 'provider_failed',
            retryable: false
          }
    latestProviderOccurrence.set(existing.evidenceId, callback.occurredAt)
    evidenceByProviderId.set(callback.providerReferenceFingerprint, updated)
    for (const [key, value] of evidenceByIdempotency)
      if (value.evidenceId === existing.evidenceId)
        evidenceByIdempotency.set(key, updated)
    return 'applied' as const
  }

  const latestOwnerActivationAttempt = (merchantId: string) => {
    let latest: readonly [string, TransactionalEmailEvidence] | undefined
    let latestOrder = -1
    for (const entry of evidenceByIdempotency) {
      const evidence = entry[1]
      const attemptOrder = attemptOrderByIdempotency.get(entry[0]) ?? -1
      if (
        evidence.merchantId === merchantId &&
        evidence.templateKey.startsWith('owner_activation_test_') &&
        attemptOrder > latestOrder
      ) {
        latest = entry
        latestOrder = attemptOrder
      }
    }
    return latest
  }

  return Layer.succeed(TransactionalEmail)({
    sendOwnerActivationTest: (command) =>
      Effect.gen(function* () {
        if (!command.verifiedOwnerEmail)
          return yield* new TransactionalEmailRejected({
            reason: 'owner_email_not_verified'
          })
        const destination = normalizeOwnerEmail(command.verifiedOwnerEmail)
        if (!destination)
          return yield* new TransactionalEmailRejected({
            reason: 'invalid_destination'
          })
        if (provider.state === 'needs_configuration' || provider.state === 'disabled') {
          return yield* new TransactionalEmailRejected({ reason: provider.state })
        }
        const template = ownerActivationTemplates[command.locale]
        const destinationFingerprint =
          yield* provider.fingerprintDestination(destination)
        const signature = JSON.stringify([
          command.merchantId,
          command.ownerUserId,
          command.locale,
          template.key,
          destinationFingerprint,
          provider.sender ?? ''
        ])
        const replay = evidenceByIdempotency.get(command.idempotencyKey)
        const priorSignature = commandSignatures.get(command.idempotencyKey)
        if (replay && priorSignature !== signature)
          return yield* new TransactionalEmailRejected({
            reason: 'idempotency_key_conflict'
          })
        if (replay && !replay.retryable) return replay
        latestAttemptOrder += 1
        attemptOrderByIdempotency.set(command.idempotencyKey, latestAttemptOrder)
        const result = yield* provider.submit({
          idempotencyKey: command.idempotencyKey,
          from: provider.sender ?? '',
          to: destination,
          subject: template.subject,
          text: template.text,
          locale: command.locale,
          templateKey: template.key
        })
        const base = {
          evidenceId: `eml_${crypto.randomUUID()}`,
          merchantId: command.merchantId,
          locale: command.locale,
          templateKey: template.key,
          maskedDestination: maskEmail(destination),
          attemptedAt: command.now,
          attemptCount: (replay?.attemptCount ?? 0) + 1
        } as const
        const evidence: TransactionalEmailEvidence = evidenceFromSubmission(
          base,
          result
        )
        evidenceByIdempotency.set(command.idempotencyKey, evidence)
        commandSignatures.set(command.idempotencyKey, signature)
        if (result._tag === 'accepted') {
          evidenceByProviderId.set(result.providerReferenceFingerprint, evidence)
          const pending =
            pendingCallbacks.get(result.providerReferenceFingerprint) ?? []
          for (const callback of [...pending].sort((left, right) =>
            right.occurredAt.localeCompare(left.occurredAt)
          ))
            applySeedCallback(callback)
          pendingCallbacks.delete(result.providerReferenceFingerprint)
        }
        return evidenceByIdempotency.get(command.idempotencyKey) ?? evidence
      }),
    ownerActivationTestAttempt: ({ merchantId }) => {
      const latest = latestOwnerActivationAttempt(merchantId)
      return Effect.succeed(
        latest
          ? ownerActivationTestAttemptRecord(merchantId, latest[0], latest[1])
          : null
      )
    },
    readiness: (merchantId) => {
      const latest = latestOwnerActivationAttempt(merchantId)?.[1]
      return Effect.succeed(
        latest
          ? readinessFromEvidence(merchantId, provider.state, latest)
          : configurationReadiness(merchantId)
      )
    },
    receiveCallback: (callbackInput) =>
      Effect.gen(function* () {
        const callback = yield* provider.verifyCallback(callbackInput)
        if (callback._tag === 'rejected')
          return yield* new TransactionalEmailCallbackRejected({
            code: callback.code
          })
        if (callback._tag === 'ignored') return 'ignored' as const
        if (callbackEvents.has(callback.eventFingerprint)) return 'duplicate' as const
        callbackEvents.add(callback.eventFingerprint)
        const outcome = applySeedCallback(callback)
        if (outcome === 'ignored') {
          pendingCallbacks.set(callback.providerReferenceFingerprint, [
            ...(pendingCallbacks.get(callback.providerReferenceFingerprint) ?? []),
            callback
          ])
          return 'pending' as const
        }
        return outcome
      })
  })
}

const evidenceProjection = (row: typeof emailEvidenceTable.$inferSelect) => ({
  evidenceId: row.id,
  merchantId: row.merchantId,
  status: row.status,
  locale: row.locale,
  templateKey: row.templateKey,
  maskedDestination: row.maskedDestination,
  attemptedAt: row.attemptedAt,
  attemptCount: row.attemptCount,
  retryable: row.retryable,
  ...(row.acceptedAt ? { acceptedAt: row.acceptedAt } : {}),
  ...(row.deliveredAt ? { deliveredAt: row.deliveredAt } : {}),
  ...(row.failureCode ? { failureCode: row.failureCode } : {})
})

export const makeLiveTransactionalEmailLayer = (
  provider: TransactionalEmailProvider
): Layer.Layer<TransactionalEmail, never, Database> =>
  Layer.effect(
    TransactionalEmail,
    Effect.gen(function* () {
      const db = yield* Database
      const rawD1 = rawD1FromDatabase(db)
      const readEvidence = (idempotencyKey: string) =>
        orUnavailable('transactional-email')(
          db
            .select()
            .from(emailEvidenceTable)
            .where(eq(emailEvidenceTable.idempotencyKey, idempotencyKey))
            .limit(1)
        )
      const latestOwnerActivationEvidence = (merchantId: string) =>
        orUnavailable('transactional-email')(
          db
            .select()
            .from(emailEvidenceTable)
            .where(
              and(
                eq(emailEvidenceTable.merchantId, merchantId),
                eq(emailEvidenceTable.purpose, 'owner_activation_test'),
                eq(emailEvidenceTable.senderIdentity, provider.sender ?? '')
              )
            )
            .orderBy(desc(emailEvidenceTable.attemptOrder))
            .limit(1)
        )
      const expireStaleSubmissions = (merchantId: string, now: string) =>
        orUnavailable('transactional-email')(
          db
            .update(emailEvidenceTable)
            .set({
              status: 'submission_unknown',
              failureCode: 'submission_interrupted',
              retryable: false,
              updatedAt: now
            })
            .where(
              and(
                eq(emailEvidenceTable.merchantId, merchantId),
                eq(emailEvidenceTable.purpose, 'owner_activation_test'),
                eq(emailEvidenceTable.senderIdentity, provider.sender ?? ''),
                eq(emailEvidenceTable.status, 'submitting'),
                lt(emailEvidenceTable.updatedAt, submissionLeaseCutoff(now))
              )
            )
        )
      const applyVerifiedCallback = (callback: {
        readonly eventFingerprint: string
        readonly providerReferenceFingerprint: string
        readonly status: 'delivered' | 'failed'
        readonly occurredAt: string
        readonly code?: string
      }) =>
        Effect.tryPromise({
          try: async () => {
            const evidence = await rawD1
              .prepare(
                `SELECT id FROM transactional_email_evidence
                 WHERE provider_reference_fingerprint = ? LIMIT 1`
              )
              .bind(callback.providerReferenceFingerprint)
              .first<{ id: string }>()
            if (!evidence) return 'pending' as const
            const status = callback.status
            await rawD1.batch([
              rawD1
                .prepare(
                  `UPDATE transactional_email_evidence
                   SET status = ?, delivered_at = ?, failure_code = ?, retryable = 0,
                       latest_provider_occurred_at = ?, updated_at = ?
                   WHERE id = ? AND status = 'accepted'
                     AND (latest_provider_occurred_at IS NULL OR latest_provider_occurred_at < ?)`
                )
                .bind(
                  status,
                  status === 'delivered' ? callback.occurredAt : null,
                  status === 'failed' ? (callback.code ?? 'provider_failed') : null,
                  callback.occurredAt,
                  callback.occurredAt,
                  evidence.id,
                  callback.occurredAt
                ),
              rawD1
                .prepare(
                  `UPDATE transactional_email_callback_receipts
                   SET evidence_id = ?, outcome = CASE
                     WHEN EXISTS (
                       SELECT 1 FROM transactional_email_evidence
                       WHERE id = ? AND status = ? AND latest_provider_occurred_at = ?
                     ) THEN 'applied' ELSE 'out_of_order' END
                   WHERE event_id = ? AND outcome = 'pending'`
                )
                .bind(
                  evidence.id,
                  evidence.id,
                  status,
                  callback.occurredAt,
                  callback.eventFingerprint
                )
            ])
            const receipt = await rawD1
              .prepare(
                `SELECT outcome FROM transactional_email_callback_receipts
                 WHERE event_id = ? LIMIT 1`
              )
              .bind(callback.eventFingerprint)
              .first<{ outcome: 'applied' | 'out_of_order' }>()
            return receipt?.outcome ?? ('out_of_order' as const)
          },
          catch: (cause) =>
            new CapabilityUnavailable({
              capability: 'transactional-email',
              reason: cause instanceof Error ? cause.message : String(cause)
            })
        })
      const reconcilePendingCallbacks = (fingerprint: string) =>
        Effect.tryPromise({
          try: async () => {
            const pending = await rawD1
              .prepare(
                `SELECT event_id, provider_status, provider_occurred_at, normalized_code
                 FROM transactional_email_callback_receipts
                 WHERE provider_reference_fingerprint = ? AND outcome = 'pending'
                 ORDER BY provider_occurred_at DESC`
              )
              .bind(fingerprint)
              .all<{
                event_id: string
                provider_status: 'delivered' | 'failed'
                provider_occurred_at: string
                normalized_code: string | null
              }>()
            return pending.results
          },
          catch: (cause) =>
            new CapabilityUnavailable({
              capability: 'transactional-email',
              reason: cause instanceof Error ? cause.message : String(cause)
            })
        }).pipe(
          Effect.flatMap((pending) =>
            Effect.forEach(pending, (item) =>
              applyVerifiedCallback({
                eventFingerprint: item.event_id,
                providerReferenceFingerprint: fingerprint,
                status: item.provider_status,
                occurredAt: item.provider_occurred_at,
                ...(item.normalized_code ? { code: item.normalized_code } : {})
              })
            )
          ),
          Effect.asVoid
        )
      return {
        sendOwnerActivationTest: (command) =>
          Effect.gen(function* () {
            if (
              provider.state === 'needs_configuration' ||
              provider.state === 'disabled'
            )
              return yield* new TransactionalEmailRejected({ reason: provider.state })
            yield* expireStaleSubmissions(command.merchantId, command.now)
            const [owner] = yield* orUnavailable('transactional-email')(
              db
                .select({ email: user.email, emailVerified: user.emailVerified })
                .from(merchantMemberships)
                .innerJoin(user, eq(user.id, merchantMemberships.userId))
                .where(
                  and(
                    eq(merchantMemberships.merchantId, command.merchantId),
                    eq(merchantMemberships.userId, command.ownerUserId)
                  )
                )
                .limit(1)
            )
            if (!owner?.emailVerified)
              return yield* new TransactionalEmailRejected({
                reason: 'owner_email_not_verified'
              })
            const destination = normalizeOwnerEmail(owner.email)
            if (!destination)
              return yield* new TransactionalEmailRejected({
                reason: 'invalid_destination'
              })
            const template = ownerActivationTemplates[command.locale]
            const destinationFingerprint =
              yield* provider.fingerprintDestination(destination)
            const proposedEvidenceId = `eml_${crypto.randomUUID()}`
            const inserted = yield* orUnavailable('transactional-email')(
              db
                .insert(emailEvidenceTable)
                .values({
                  id: proposedEvidenceId,
                  merchantId: command.merchantId,
                  ownerUserId: command.ownerUserId,
                  idempotencyKey: command.idempotencyKey,
                  purpose: 'owner_activation_test',
                  locale: command.locale,
                  templateKey: template.key,
                  maskedDestination: maskEmail(destination),
                  destinationFingerprint,
                  senderIdentity: provider.sender ?? '',
                  status: 'submitting',
                  attemptedAt: command.now,
                  attemptCount: 1,
                  attemptOrder: sql`(SELECT COALESCE(MAX(attempt_order), 0) + 1 FROM transactional_email_evidence)`,
                  retryable: false,
                  updatedAt: command.now
                })
                .onConflictDoNothing({ target: emailEvidenceTable.idempotencyKey })
                .returning({ id: emailEvidenceTable.id })
            )
            let evidenceId = inserted[0]?.id
            if (!evidenceId) {
              const existing = (yield* readEvidence(command.idempotencyKey))[0]
              if (!existing)
                return yield* new CapabilityUnavailable({
                  capability: 'transactional-email',
                  reason: 'idempotency_claim_lost'
                })
              if (
                existing.merchantId !== command.merchantId ||
                existing.ownerUserId !== command.ownerUserId ||
                existing.locale !== command.locale ||
                existing.templateKey !== template.key ||
                existing.senderIdentity !== (provider.sender ?? '')
              )
                return yield* new TransactionalEmailRejected({
                  reason: 'idempotency_key_conflict'
                })
              if (existing.destinationFingerprint === null) {
                if (existing.retryable)
                  return yield* new TransactionalEmailRejected({
                    reason: 'idempotency_key_conflict'
                  })
                return evidenceProjection(existing)
              }
              if (existing.destinationFingerprint !== destinationFingerprint)
                return yield* new TransactionalEmailRejected({
                  reason: 'idempotency_key_conflict'
                })
              if (!existing.retryable) return evidenceProjection(existing)
              const claimed = yield* orUnavailable('transactional-email')(
                db
                  .update(emailEvidenceTable)
                  .set({
                    status: 'submitting',
                    attemptedAt: command.now,
                    attemptCount: existing.attemptCount + 1,
                    attemptOrder: sql`(SELECT COALESCE(MAX(attempt_order), 0) + 1 FROM transactional_email_evidence)`,
                    retryable: false,
                    updatedAt: command.now
                  })
                  .where(
                    and(
                      eq(emailEvidenceTable.id, existing.id),
                      eq(emailEvidenceTable.status, 'failed'),
                      eq(emailEvidenceTable.retryable, true)
                    )
                  )
                  .returning({ id: emailEvidenceTable.id })
              )
              if (claimed.length === 0) {
                const replay = (yield* readEvidence(command.idempotencyKey))[0]
                if (!replay)
                  return yield* new CapabilityUnavailable({
                    capability: 'transactional-email',
                    reason: 'idempotency_claim_lost'
                  })
                return evidenceProjection(replay)
              }
              evidenceId = existing.id
            }
            const result = yield* provider.submit({
              idempotencyKey: command.idempotencyKey,
              from: provider.sender ?? '',
              to: destination,
              subject: template.subject,
              text: template.text,
              locale: command.locale,
              templateKey: template.key
            })
            const persisted = submissionPersistence(result)
            yield* orUnavailable('transactional-email')(
              db
                .update(emailEvidenceTable)
                .set({
                  ...persisted,
                  updatedAt: command.now
                })
                .where(
                  and(
                    eq(emailEvidenceTable.id, evidenceId),
                    eq(emailEvidenceTable.status, 'submitting')
                  )
                )
            )
            if (persisted.providerReferenceFingerprint)
              yield* reconcilePendingCallbacks(persisted.providerReferenceFingerprint)
            const row = (yield* readEvidence(command.idempotencyKey))[0]!
            return evidenceProjection(row)
          }),
        ownerActivationTestAttempt: ({ merchantId, now }) =>
          Effect.gen(function* () {
            yield* expireStaleSubmissions(merchantId, now)
            const [latest] = yield* latestOwnerActivationEvidence(merchantId)
            return latest
              ? ownerActivationTestAttemptRecord(
                  merchantId,
                  latest.idempotencyKey,
                  evidenceProjection(latest)
                )
              : null
          }),
        readiness: (merchantId) =>
          Effect.gen(function* () {
            yield* expireStaleSubmissions(merchantId, new Date().toISOString())
            const [latest] = yield* latestOwnerActivationEvidence(merchantId)
            return readinessFromEvidence(
              merchantId,
              provider.state,
              latest
                ? {
                    evidenceId: latest.id,
                    status: latest.status,
                    ...(latest.failureCode ? { failureCode: latest.failureCode } : {})
                  }
                : undefined
            )
          }),
        receiveCallback: (callbackInput) =>
          Effect.gen(function* () {
            const callback = yield* provider.verifyCallback(callbackInput)
            if (callback._tag === 'rejected')
              return yield* new TransactionalEmailCallbackRejected({
                code: callback.code
              })
            if (callback._tag === 'ignored') return 'ignored' as const
            const fingerprint = callback.providerReferenceFingerprint
            const inserted = yield* orUnavailable('transactional-email')(
              db
                .insert(transactionalEmailCallbackReceipts)
                .values({
                  eventId: callback.eventFingerprint,
                  evidenceId: null,
                  outcome: 'pending',
                  providerReferenceFingerprint: fingerprint,
                  providerStatus: callback.status,
                  providerOccurredAt: callback.occurredAt,
                  normalizedCode: callback.code ?? null,
                  receivedAt: callbackInput.now
                })
                .onConflictDoNothing({
                  target: transactionalEmailCallbackReceipts.eventId
                })
                .returning({ eventId: transactionalEmailCallbackReceipts.eventId })
            )
            if (inserted.length === 0) {
              return 'duplicate' as const
            }
            return yield* applyVerifiedCallback(callback)
          })
      }
    })
  )
