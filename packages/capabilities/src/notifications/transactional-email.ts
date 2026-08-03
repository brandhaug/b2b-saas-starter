import { Context, Effect, Layer, Schema } from 'effect'
import { and, desc, eq, sql } from 'drizzle-orm'
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

export type TransactionalEmailRuntime = 'local' | 'test' | 'preview' | 'production'
export type TransactionalEmailLocale = 'ro' | 'en'
export type TransactionalEmailProviderState =
  | 'capture'
  | 'configured'
  | 'needs_configuration'
  | 'disabled'

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

export type RecoverableOwnerActivationTest = {
  readonly commandId: string
  readonly evidence: TransactionalEmailEvidence
}

const recoverableOwnerActivationTest = (
  merchantId: string,
  idempotencyKey: string,
  evidence: TransactionalEmailEvidence
): RecoverableOwnerActivationTest | null => {
  if (!canReuseOwnerActivationTestCommand(evidence)) return null
  const commandId = ownerActivationTestCommandId(merchantId, idempotencyKey)
  return commandId ? { commandId, evidence } : null
}

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

export type EmailProviderSubmission =
  | { readonly _tag: 'captured'; readonly capturedAt: string }
  | {
      readonly _tag: 'accepted'
      readonly providerReferenceFingerprint: string
      readonly acceptedAt: string
    }
  | { readonly _tag: 'failed'; readonly code: string; readonly retryable: boolean }
  | { readonly _tag: 'submission_unknown'; readonly code: string }

export type EmailProviderCallback =
  | {
      readonly _tag: 'verified'
      readonly providerReferenceFingerprint: string
      readonly eventFingerprint: string
      readonly status: 'delivered' | 'failed'
      readonly occurredAt: string
      readonly code?: string
    }
  | { readonly _tag: 'ignored' }
  | { readonly _tag: 'rejected'; readonly code: string }

export type TransactionalEmailProvider = {
  readonly state: TransactionalEmailProviderState
  readonly sender?: string
  readonly fingerprintDestination: (
    destination: string
  ) => Effect.Effect<string, CapabilityUnavailable>
  readonly submit: (input: {
    readonly idempotencyKey: string
    readonly from: string
    readonly to: string
    readonly subject: string
    readonly text: string
    readonly locale: TransactionalEmailLocale
    readonly templateKey: string
  }) => Effect.Effect<EmailProviderSubmission, CapabilityUnavailable>
  readonly verifyCallback: (input: {
    readonly rawBody: string
    readonly signature: string
    readonly timestamp: string
    readonly now?: string
  }) => Effect.Effect<EmailProviderCallback, CapabilityUnavailable>
  readonly signCallbackForTest?: (timestamp: string, rawBody: string) => Promise<string>
}

export class TransactionalEmailCallbackRejected extends Schema.TaggedErrorClass<TransactionalEmailCallbackRejected>()(
  'TransactionalEmailCallbackRejected',
  { code: Schema.String }
) {}

const hex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  )

const hmac = async (secret: string, value: string) => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)))
}

const providerReferenceFingerprint = async (secret: string, value: string) =>
  `hmac-sha256:${await hmac(secret, value)}`

const normalizeProviderFailureCode = (value: unknown) =>
  value === 'hard_bounce' || value === 'complaint' || value === 'rejected'
    ? value
    : 'provider_failed'

const sameSignature = (left: string, right: string) => {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return difference === 0
}

export const makeConfiguredTransactionalEmailProvider = (input: {
  readonly sender: string
  readonly callbackSecret: string
  readonly providerReferenceFingerprintKey: string
  readonly timeoutMs?: number
  readonly send: (message: {
    readonly idempotencyKey: string
    readonly from: string
    readonly to: string
    readonly subject: string
    readonly text: string
  }) => Promise<{ readonly providerSubmissionId: string; readonly acceptedAt: string }>
}): TransactionalEmailProvider => {
  const sign = (timestamp: string, rawBody: string) =>
    hmac(input.callbackSecret, `${timestamp}.${rawBody}`)
  return {
    state: 'configured',
    sender: input.sender,
    fingerprintDestination: (destination) =>
      Effect.promise(() =>
        providerReferenceFingerprint(
          input.providerReferenceFingerprintKey,
          `destination:${destination}`
        )
      ),
    submit: (message) =>
      Effect.tryPromise({
        try: () => input.send(message),
        catch: () =>
          new CapabilityUnavailable({
            capability: 'transactional-email-provider',
            reason: 'provider_request_failed'
          })
      }).pipe(
        Effect.flatMap((accepted) =>
          Effect.map(
            Effect.promise(() =>
              providerReferenceFingerprint(
                input.providerReferenceFingerprintKey,
                accepted.providerSubmissionId
              )
            ),
            (fingerprint): EmailProviderSubmission => ({
              _tag: 'accepted',
              providerReferenceFingerprint: fingerprint,
              acceptedAt: accepted.acceptedAt
            })
          )
        ),
        Effect.catch(() =>
          Effect.succeed<EmailProviderSubmission>({
            _tag: 'submission_unknown',
            code: 'provider_request_failed'
          })
        ),
        Effect.timeoutOrElse({
          duration: `${input.timeoutMs ?? 10_000} millis`,
          orElse: () =>
            Effect.succeed<EmailProviderSubmission>({
              _tag: 'submission_unknown',
              code: 'provider_timeout'
            })
        })
      ),
    verifyCallback: ({ rawBody, signature, timestamp, now }) =>
      Effect.tryPromise({
        try: async (): Promise<EmailProviderCallback> => {
          if (
            !Number.isFinite(Date.parse(timestamp)) ||
            (now && Math.abs(Date.parse(now) - Date.parse(timestamp)) > 5 * 60_000)
          )
            return { _tag: 'rejected', code: 'stale_timestamp' }
          const expected = await sign(timestamp, rawBody)
          if (!sameSignature(expected, signature))
            return { _tag: 'rejected', code: 'invalid_signature' }
          let parsed: Record<string, unknown>
          try {
            parsed = JSON.parse(rawBody) as Record<string, unknown>
          } catch {
            return { _tag: 'rejected', code: 'invalid_payload' }
          }
          if (
            typeof parsed.eventId !== 'string' ||
            parsed.eventId.length === 0 ||
            typeof parsed.messageId !== 'string' ||
            parsed.messageId.length === 0 ||
            (parsed.status !== 'delivered' && parsed.status !== 'failed') ||
            typeof parsed.occurredAt !== 'string' ||
            !Number.isFinite(Date.parse(parsed.occurredAt))
          )
            return { _tag: 'rejected', code: 'invalid_payload' }
          return {
            _tag: 'verified',
            eventFingerprint: await providerReferenceFingerprint(
              input.providerReferenceFingerprintKey,
              parsed.eventId
            ),
            providerReferenceFingerprint: await providerReferenceFingerprint(
              input.providerReferenceFingerprintKey,
              parsed.messageId
            ),
            status: parsed.status,
            occurredAt: new Date(Date.parse(parsed.occurredAt)).toISOString(),
            ...(parsed.status === 'failed'
              ? { code: normalizeProviderFailureCode(parsed.code) }
              : {})
          }
        },
        catch: () =>
          new CapabilityUnavailable({
            capability: 'transactional-email-callback',
            reason: 'callback_verification_failed'
          })
      }),
    signCallbackForTest: sign
  }
}

const templates = {
  ro: {
    key: 'owner_activation_test_ro_v1',
    subject: 'Test BeeSolo de e-mail tranzacțional',
    text: 'E-mailul tranzacțional BeeSolo este configurat pentru afacerea ta.'
  },
  en: {
    key: 'owner_activation_test_en_v1',
    subject: 'BeeSolo transactional email test',
    text: 'BeeSolo transactional email is configured for your business.'
  }
} as const

const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const maskEmail = (email: string) => {
  const [local = '', domain = ''] = email.split('@')
  return `${local.slice(0, 1)}••••@${domain}`
}

const captureProvider = (): TransactionalEmailProvider => ({
  state: 'capture',
  sender: 'capture@beesolo.local',
  fingerprintDestination: (destination) =>
    Effect.promise(() =>
      providerReferenceFingerprint(
        'beesolo-local-capture-destination-key',
        `destination:${destination}`
      )
    ),
  submit: () =>
    Effect.succeed({ _tag: 'captured', capturedAt: new Date().toISOString() }),
  verifyCallback: () => Effect.succeed({ _tag: 'ignored' })
})

const unavailableProvider = (
  state: 'needs_configuration' | 'disabled'
): TransactionalEmailProvider => ({
  state,
  fingerprintDestination: () =>
    Effect.fail(
      new CapabilityUnavailable({
        capability: 'transactional-email-provider',
        reason: state
      })
    ),
  submit: () =>
    Effect.fail(
      new CapabilityUnavailable({
        capability: 'transactional-email-provider',
        reason: state
      })
    ),
  verifyCallback: () => Effect.succeed({ _tag: 'rejected', code: state })
})

export const selectTransactionalEmailProvider = (input: {
  readonly runtime: TransactionalEmailRuntime
  readonly provider?: TransactionalEmailProvider
  readonly disabled?: boolean
}) =>
  input.disabled
    ? unavailableProvider('disabled')
    : input.provider
      ? input.provider
      : input.runtime === 'local' || input.runtime === 'test'
        ? captureProvider()
        : unavailableProvider('needs_configuration')

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
  readonly recoverableOwnerActivationTest: (
    merchantId: string
  ) => Effect.Effect<RecoverableOwnerActivationTest | null, CapabilityUnavailable>
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
  const readiness = new Map<string, NotificationReadiness>()
  const callbackEvents = new Set<string>()
  const latestProviderOccurrence = new Map<string, string>()
  const pendingCallbacks = new Map<
    string,
    readonly Extract<EmailProviderCallback, { readonly _tag: 'verified' }>[]
  >()

  const configurationReadiness = (merchantId: string): NotificationReadiness =>
    provider.state === 'needs_configuration' || provider.state === 'disabled'
      ? { merchantId, state: provider.state, reason: `email_${provider.state}` }
      : { merchantId, state: 'not_tested' }

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
    readiness.set(
      existing.merchantId,
      updated.status === 'failed'
        ? {
            merchantId: existing.merchantId,
            state: 'failed',
            reason: updated.failureCode ?? 'provider_failed'
          }
        : {
            merchantId: existing.merchantId,
            state: 'ready',
            acceptedEvidenceId: existing.evidenceId
          }
    )
    return 'applied' as const
  }

  return Layer.succeed(TransactionalEmail)({
    sendOwnerActivationTest: (command) =>
      Effect.gen(function* () {
        if (!command.verifiedOwnerEmail)
          return yield* new TransactionalEmailRejected({
            reason: 'owner_email_not_verified'
          })
        const destination = command.verifiedOwnerEmail.trim().toLowerCase()
        if (!validEmail.test(destination))
          return yield* new TransactionalEmailRejected({
            reason: 'invalid_destination'
          })
        if (provider.state === 'needs_configuration' || provider.state === 'disabled') {
          readiness.set(command.merchantId, configurationReadiness(command.merchantId))
          return yield* new TransactionalEmailRejected({ reason: provider.state })
        }
        const template = templates[command.locale]
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
        const evidence: TransactionalEmailEvidence =
          result._tag === 'captured'
            ? { ...base, status: 'captured', retryable: false }
            : result._tag === 'accepted'
              ? {
                  ...base,
                  status: 'accepted',
                  acceptedAt: result.acceptedAt,
                  retryable: false
                }
              : result._tag === 'submission_unknown'
                ? {
                    ...base,
                    status: 'submission_unknown',
                    failureCode: result.code,
                    retryable: false
                  }
                : {
                    ...base,
                    status: 'failed',
                    failureCode: result.code,
                    retryable: result.retryable
                  }
        evidenceByIdempotency.set(command.idempotencyKey, evidence)
        commandSignatures.set(command.idempotencyKey, signature)
        if (result._tag === 'accepted') {
          evidenceByProviderId.set(result.providerReferenceFingerprint, evidence)
          if (provider.state === 'configured')
            readiness.set(command.merchantId, {
              merchantId: command.merchantId,
              state: 'ready',
              acceptedEvidenceId: evidence.evidenceId
            })
          const pending =
            pendingCallbacks.get(result.providerReferenceFingerprint) ?? []
          for (const callback of [...pending].sort((left, right) =>
            right.occurredAt.localeCompare(left.occurredAt)
          ))
            applySeedCallback(callback)
          pendingCallbacks.delete(result.providerReferenceFingerprint)
        } else if (result._tag === 'failed') {
          readiness.set(command.merchantId, {
            merchantId: command.merchantId,
            state: 'failed',
            reason: result.code
          })
        } else if (result._tag === 'submission_unknown') {
          readiness.set(command.merchantId, {
            merchantId: command.merchantId,
            state: 'failed',
            reason: result.code
          })
        }
        return evidenceByIdempotency.get(command.idempotencyKey) ?? evidence
      }),
    recoverableOwnerActivationTest: (merchantId) => {
      let latest: readonly [string, TransactionalEmailEvidence] | undefined
      for (const entry of evidenceByIdempotency) {
        const evidence = entry[1]
        if (
          evidence.merchantId === merchantId &&
          evidence.templateKey.startsWith('owner_activation_test_') &&
          (!latest || evidence.attemptedAt >= latest[1].attemptedAt)
        )
          latest = entry
      }
      return Effect.succeed(
        latest ? recoverableOwnerActivationTest(merchantId, latest[0], latest[1]) : null
      )
    },
    readiness: (merchantId) =>
      Effect.succeed(readiness.get(merchantId) ?? configurationReadiness(merchantId)),
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
            .orderBy(
              desc(emailEvidenceTable.attemptedAt),
              desc(emailEvidenceTable.updatedAt),
              desc(sql`rowid`)
            )
            .limit(1)
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
            const destination = owner.email.trim().toLowerCase()
            if (!validEmail.test(destination))
              return yield* new TransactionalEmailRejected({
                reason: 'invalid_destination'
              })
            const template = templates[command.locale]
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
            const providerFingerprint =
              result._tag === 'accepted' ? result.providerReferenceFingerprint : null
            const status =
              result._tag === 'captured'
                ? ('captured' as const)
                : result._tag === 'accepted'
                  ? ('accepted' as const)
                  : result._tag === 'submission_unknown'
                    ? ('submission_unknown' as const)
                    : ('failed' as const)
            yield* orUnavailable('transactional-email')(
              db
                .update(emailEvidenceTable)
                .set({
                  status,
                  providerReferenceFingerprint: providerFingerprint,
                  acceptedAt: result._tag === 'accepted' ? result.acceptedAt : null,
                  failureCode:
                    result._tag === 'failed' || result._tag === 'submission_unknown'
                      ? result.code
                      : null,
                  retryable: result._tag === 'failed' && result.retryable,
                  updatedAt: command.now
                })
                .where(
                  and(
                    eq(emailEvidenceTable.id, evidenceId),
                    eq(emailEvidenceTable.status, 'submitting')
                  )
                )
            )
            if (providerFingerprint)
              yield* reconcilePendingCallbacks(providerFingerprint)
            const row = (yield* readEvidence(command.idempotencyKey))[0]!
            return evidenceProjection(row)
          }),
        recoverableOwnerActivationTest: (merchantId) =>
          Effect.gen(function* () {
            const [latest] = yield* latestOwnerActivationEvidence(merchantId)
            return latest
              ? recoverableOwnerActivationTest(
                  merchantId,
                  latest.idempotencyKey,
                  evidenceProjection(latest)
                )
              : null
          }),
        readiness: (merchantId) =>
          Effect.gen(function* () {
            if (
              provider.state === 'needs_configuration' ||
              provider.state === 'disabled'
            )
              return {
                merchantId,
                state: provider.state,
                reason: `email_${provider.state}`
              } as NotificationReadiness
            const [latest] = yield* latestOwnerActivationEvidence(merchantId)
            if (!latest) return { merchantId, state: 'not_tested' as const }
            if (latest.status === 'accepted' || latest.status === 'delivered')
              return {
                merchantId,
                state: 'ready' as const,
                acceptedEvidenceId: latest.id
              }
            if (latest.status === 'failed' || latest.status === 'submission_unknown')
              return {
                merchantId,
                state: 'failed' as const,
                reason: latest.failureCode ?? latest.status
              }
            return { merchantId, state: 'not_tested' as const }
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
