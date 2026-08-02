import { Context, Effect, Layer, Schema } from 'effect'
import { and, desc, eq, inArray } from 'drizzle-orm'
import {
  Database,
  merchantMemberships,
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
      'needs_configuration',
      'disabled'
    ])
  }
) {}

export type EmailProviderSubmission =
  | { readonly _tag: 'captured'; readonly capturedAt: string }
  | {
      readonly _tag: 'accepted'
      readonly providerSubmissionId: string
      readonly acceptedAt: string
    }
  | { readonly _tag: 'failed'; readonly code: string; readonly retryable: boolean }
  | { readonly _tag: 'submission_unknown'; readonly code: string }

export type EmailProviderCallback =
  | {
      readonly _tag: 'verified'
      readonly providerSubmissionId: string
      readonly eventId: string
      readonly status: 'delivered' | 'failed'
      readonly occurredAt: string
      readonly code?: string
    }
  | { readonly _tag: 'ignored' }
  | { readonly _tag: 'rejected'; readonly code: string }

export type TransactionalEmailProvider = {
  readonly state: TransactionalEmailProviderState
  readonly sender?: string
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
    submit: (message) =>
      Effect.tryPromise({
        try: () => input.send(message),
        catch: () =>
          new CapabilityUnavailable({
            capability: 'transactional-email-provider',
            reason: 'provider_request_failed'
          })
      }).pipe(
        Effect.map(
          (accepted): EmailProviderSubmission => ({ _tag: 'accepted', ...accepted })
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
          const parsed = JSON.parse(rawBody) as Record<string, unknown>
          if (
            typeof parsed.eventId !== 'string' ||
            typeof parsed.providerSubmissionId !== 'string' ||
            (parsed.status !== 'delivered' && parsed.status !== 'failed') ||
            typeof parsed.occurredAt !== 'string'
          )
            return { _tag: 'rejected', code: 'invalid_payload' }
          return {
            _tag: 'verified',
            eventId: parsed.eventId,
            providerSubmissionId: parsed.providerSubmissionId,
            status: parsed.status,
            occurredAt: parsed.occurredAt,
            ...(typeof parsed.code === 'string' ? { code: parsed.code } : {})
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
  submit: () =>
    Effect.succeed({ _tag: 'captured', capturedAt: new Date().toISOString() }),
  verifyCallback: () => Effect.succeed({ _tag: 'ignored' })
})

const unavailableProvider = (
  state: 'needs_configuration' | 'disabled'
): TransactionalEmailProvider => ({
  state,
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
  readonly receiveCallback: (input: {
    readonly rawBody: string
    readonly signature: string
    readonly timestamp: string
    readonly now: string
  }) => Effect.Effect<'applied' | 'duplicate' | 'ignored', CapabilityUnavailable>
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
  const evidenceByProviderId = new Map<string, TransactionalEmailEvidence>()
  const readiness = new Map<string, NotificationReadiness>()
  const callbackEvents = new Set<string>()

  const configurationReadiness = (merchantId: string): NotificationReadiness =>
    provider.state === 'needs_configuration' || provider.state === 'disabled'
      ? { merchantId, state: provider.state, reason: `email_${provider.state}` }
      : { merchantId, state: 'not_tested' }

  return Layer.succeed(TransactionalEmail)({
    sendOwnerActivationTest: (command) =>
      Effect.gen(function* () {
        const replay = evidenceByIdempotency.get(command.idempotencyKey)
        if (replay && !replay.retryable) return replay
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
        if (result._tag === 'accepted') {
          evidenceByProviderId.set(result.providerSubmissionId, evidence)
          if (provider.state === 'configured')
            readiness.set(command.merchantId, {
              merchantId: command.merchantId,
              state: 'ready',
              acceptedEvidenceId: evidence.evidenceId
            })
        } else if (result._tag === 'failed') {
          readiness.set(command.merchantId, {
            merchantId: command.merchantId,
            state: 'failed',
            reason: result.code
          })
        }
        return evidence
      }),
    readiness: (merchantId) =>
      Effect.succeed(readiness.get(merchantId) ?? configurationReadiness(merchantId)),
    receiveCallback: (callbackInput) =>
      Effect.gen(function* () {
        const callback = yield* provider.verifyCallback(callbackInput)
        if (callback._tag !== 'verified') return 'ignored' as const
        if (callbackEvents.has(callback.eventId)) return 'duplicate' as const
        callbackEvents.add(callback.eventId)
        const existing = evidenceByProviderId.get(callback.providerSubmissionId)
        if (!existing) return 'ignored' as const
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
        evidenceByProviderId.set(callback.providerSubmissionId, updated)
        for (const [key, value] of evidenceByIdempotency)
          if (value.evidenceId === existing.evidenceId)
            evidenceByIdempotency.set(key, updated)
        return 'applied' as const
      })
  })
}

const fingerprintProviderReference = (value: string) =>
  Effect.promise(async () => {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(value)
    )
    return `sha256:${hex(digest)}`
  })

const evidenceProjection = (row: typeof emailEvidenceTable.$inferSelect) => ({
  evidenceId: row.id,
  merchantId: row.merchantId,
  status: row.status === 'submitting' ? ('submission_unknown' as const) : row.status,
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
      const readEvidence = (idempotencyKey: string) =>
        orUnavailable('transactional-email')(
          db
            .select()
            .from(emailEvidenceTable)
            .where(eq(emailEvidenceTable.idempotencyKey, idempotencyKey))
            .limit(1)
        )
      return {
        sendOwnerActivationTest: (command) =>
          Effect.gen(function* () {
            const existing = (yield* readEvidence(command.idempotencyKey))[0]
            if (existing && !existing.retryable) return evidenceProjection(existing)
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
            const evidenceId = existing?.id ?? `eml_${crypto.randomUUID()}`
            if (!existing)
              yield* orUnavailable('transactional-email')(
                db.insert(emailEvidenceTable).values({
                  id: evidenceId,
                  merchantId: command.merchantId,
                  ownerUserId: command.ownerUserId,
                  idempotencyKey: command.idempotencyKey,
                  purpose: 'owner_activation_test',
                  locale: command.locale,
                  templateKey: template.key,
                  maskedDestination: maskEmail(destination),
                  senderIdentity: provider.sender ?? '',
                  status: 'submitting',
                  attemptedAt: command.now,
                  attemptCount: 1,
                  retryable: false,
                  updatedAt: command.now
                })
              )
            else
              yield* orUnavailable('transactional-email')(
                db
                  .update(emailEvidenceTable)
                  .set({
                    status: 'submitting',
                    attemptedAt: command.now,
                    attemptCount: existing.attemptCount + 1,
                    retryable: false,
                    updatedAt: command.now
                  })
                  .where(eq(emailEvidenceTable.id, evidenceId))
              )
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
              result._tag === 'accepted'
                ? yield* fingerprintProviderReference(result.providerSubmissionId)
                : null
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
                .where(eq(emailEvidenceTable.id, evidenceId))
            )
            const row = (yield* readEvidence(command.idempotencyKey))[0]!
            return evidenceProjection(row)
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
            const [latest] = yield* orUnavailable('transactional-email')(
              db
                .select()
                .from(emailEvidenceTable)
                .where(
                  and(
                    eq(emailEvidenceTable.merchantId, merchantId),
                    eq(emailEvidenceTable.purpose, 'owner_activation_test'),
                    inArray(emailEvidenceTable.status, ['accepted', 'delivered'])
                  )
                )
                .orderBy(desc(emailEvidenceTable.acceptedAt))
                .limit(1)
            )
            return latest
              ? {
                  merchantId,
                  state: 'ready' as const,
                  acceptedEvidenceId: latest.id
                }
              : { merchantId, state: 'not_tested' as const }
          }),
        receiveCallback: (callbackInput) =>
          Effect.gen(function* () {
            const callback = yield* provider.verifyCallback(callbackInput)
            if (callback._tag !== 'verified') return 'ignored' as const
            const fingerprint = yield* fingerprintProviderReference(
              callback.providerSubmissionId
            )
            const [evidence] = yield* orUnavailable('transactional-email')(
              db
                .select()
                .from(emailEvidenceTable)
                .where(eq(emailEvidenceTable.providerReferenceFingerprint, fingerprint))
                .limit(1)
            )
            const inserted = yield* orUnavailable('transactional-email')(
              db
                .insert(transactionalEmailCallbackReceipts)
                .values({
                  eventId: callback.eventId,
                  evidenceId: evidence?.id ?? null,
                  outcome: 'pending',
                  receivedAt: callbackInput.now
                })
                .onConflictDoNothing({
                  target: transactionalEmailCallbackReceipts.eventId
                })
                .returning({ eventId: transactionalEmailCallbackReceipts.eventId })
            )
            if (inserted.length === 0) {
              const [receipt] = yield* orUnavailable('transactional-email')(
                db
                  .select({ outcome: transactionalEmailCallbackReceipts.outcome })
                  .from(transactionalEmailCallbackReceipts)
                  .where(
                    eq(transactionalEmailCallbackReceipts.eventId, callback.eventId)
                  )
                  .limit(1)
              )
              if (receipt?.outcome !== 'pending') return 'duplicate' as const
            }
            if (!evidence) return 'ignored' as const
            yield* orUnavailable('transactional-email')(
              db
                .update(emailEvidenceTable)
                .set(
                  callback.status === 'delivered'
                    ? {
                        status: 'delivered',
                        deliveredAt: callback.occurredAt,
                        retryable: false,
                        updatedAt: callbackInput.now
                      }
                    : {
                        status: 'failed',
                        failureCode: callback.code ?? 'provider_failed',
                        retryable: false,
                        updatedAt: callbackInput.now
                      }
                )
                .where(eq(emailEvidenceTable.id, evidence.id))
            )
            yield* orUnavailable('transactional-email')(
              db
                .update(transactionalEmailCallbackReceipts)
                .set({ outcome: 'applied', evidenceId: evidence.id })
                .where(eq(transactionalEmailCallbackReceipts.eventId, callback.eventId))
            )
            return 'applied' as const
          })
      }
    })
  )
