import { Context, Effect, Layer, Schema } from 'effect'
import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import {
  appointmentEmailIntents,
  Database,
  rawD1FromDatabase,
  type BatchStatement,
  type EffectDatabase
} from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import type {
  EmailProviderSubmission,
  TransactionalEmailProvider
} from './transactional-email-provider.ts'
import type { NotificationDestinationProtectionSecrets } from './booking-intent-producer.ts'
import { maskEmail, normalizeOwnerEmail } from './transactional-email-policy.ts'

export const AppointmentEmailPurpose = Schema.Literals([
  'appointment_confirmation',
  'appointment_reschedule',
  'appointment_cancellation',
  'appointment_reminder'
])
export type AppointmentEmailPurpose = typeof AppointmentEmailPurpose.Type

export const AppointmentEmailStatus = Schema.Literals([
  'pending',
  'claimed',
  'captured',
  'accepted',
  'delivered',
  'failed',
  'suppressed',
  'unavailable',
  'submission_unknown',
  'superseded',
  'superseded_after_submission'
])
export type AppointmentEmailStatus = typeof AppointmentEmailStatus.Type

export const AppointmentEmailFacts = Schema.Struct({
  merchantLabel: Schema.String,
  startsAt: Schema.String,
  timeZone: Schema.String,
  confirmationAccess: Schema.optional(
    Schema.Struct({
      merchantSlug: Schema.String,
      routeId: Schema.String,
      bookingPartyId: Schema.optional(Schema.NullOr(Schema.String)),
      purpose: Schema.optional(
        Schema.Literals(['appointment_confirmation', 'party_confirmation'])
      ),
      tokenVersion: Schema.Int,
      signingKeyId: Schema.String,
      expiresAt: Schema.String
    })
  ),
  affectedAppointmentCount: Schema.optional(Schema.Int)
})
export type AppointmentEmailFacts = typeof AppointmentEmailFacts.Type

export type AppointmentEmailWakeup = {
  readonly version: 1
  readonly kind: 'appointment-email'
  readonly intentId: string
}

const subjects: Readonly<
  Record<'ro' | 'en', Readonly<Record<AppointmentEmailPurpose, string>>>
> = {
  ro: {
    appointment_confirmation: 'Programarea ta este confirmată',
    appointment_reschedule: 'Programarea ta a fost reprogramată',
    appointment_cancellation: 'Programarea ta a fost anulată',
    appointment_reminder: 'Memento pentru programarea ta'
  },
  en: {
    appointment_confirmation: 'Your appointment is confirmed',
    appointment_reschedule: 'Your appointment was rescheduled',
    appointment_cancellation: 'Your appointment was cancelled',
    appointment_reminder: 'Your appointment reminder'
  }
}

export const appointmentEmailTemplateKey = (
  locale: 'ro' | 'en',
  purpose: AppointmentEmailPurpose
) => `beesolo_${purpose}_${locale}_v1`

export const renderAppointmentEmail = (input: {
  readonly locale: 'ro' | 'en'
  readonly purpose: AppointmentEmailPurpose
  readonly facts: AppointmentEmailFacts
  readonly confirmationUrl?: string | undefined
}) => {
  const when = `${input.facts.startsAt} (${input.facts.timeZone})`
  const count = input.facts.affectedAppointmentCount ?? 1
  const subject = subjects[input.locale][input.purpose]
  const action =
    input.locale === 'ro'
      ? input.purpose === 'appointment_confirmation'
        ? 'este confirmată'
        : input.purpose === 'appointment_reschedule'
          ? 'a fost reprogramată'
          : input.purpose === 'appointment_cancellation'
            ? 'a fost anulată'
            : 'este programată în curând'
      : input.purpose === 'appointment_confirmation'
        ? 'is confirmed'
        : input.purpose === 'appointment_reschedule'
          ? 'was rescheduled'
          : input.purpose === 'appointment_cancellation'
            ? 'was cancelled'
            : 'is coming up'
  const body =
    input.locale === 'ro'
      ? `${count > 1 ? `${count} programări` : 'Programarea'} la ${input.facts.merchantLabel} ${action}: ${when}.`
      : `${count > 1 ? `${count} appointments` : 'Your appointment'} with ${input.facts.merchantLabel} ${action}: ${when}.`
  return {
    subject,
    text: input.confirmationUrl
      ? `${body}\n${input.locale === 'ro' ? 'Detalii' : 'Details'}: ${input.confirmationUrl}`
      : body
  }
}

const confirmationAccessPurpose = (
  access: NonNullable<AppointmentEmailFacts['confirmationAccess']>
) => access.purpose ?? 'appointment_confirmation'
const confirmationAccessResource = (
  access: NonNullable<AppointmentEmailFacts['confirmationAccess']>
) => access.bookingPartyId ?? access.routeId
const deriveConfirmationUrl = async (
  access: NonNullable<AppointmentEmailFacts['confirmationAccess']>,
  keyring: Readonly<Record<string, string>>,
  publicOrigin: string
) => {
  const signingKey = keyring[access.signingKeyId]
  if (!signingKey) throw new Error('confirmation_signing_key_unavailable')
  const imported = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const value = `${confirmationAccessPurpose(access)}.${confirmationAccessResource(access)}.${access.routeId}.${access.tokenVersion}.${access.expiresAt}.${access.signingKeyId}`
  const signed = new Uint8Array(
    await crypto.subtle.sign('HMAC', imported, new TextEncoder().encode(value))
  )
  const token = Array.from(signed, (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  )
  return `${publicOrigin.replace(/\/$/, '')}/${encodeURIComponent(access.merchantSlug)}/booking/confirmations/${encodeURIComponent(access.routeId)}?token=${encodeURIComponent(token)}`
}

const bytesHex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  )
const fromHex = (value: string) =>
  new Uint8Array(value.match(/.{1,2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [])
const digest = (value: string) =>
  Effect.map(
    Effect.promise(() =>
      crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
    ),
    (result) => `sha256:${bytesHex(result)}`
  )
const hmac = (secret: string, value: string) =>
  Effect.promise(async () => {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    return `hmac-sha256:${bytesHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)))}`
  })
const encryptionKey = (secret: string) =>
  Effect.promise(async () =>
    crypto.subtle.importKey(
      'raw',
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(`beesolo-appointment-email:${secret}`)
      ),
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    )
  )
const encryptDestination = (secret: string, destination: string) =>
  Effect.gen(function* () {
    const key = yield* encryptionKey(secret)
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ciphertext = yield* Effect.promise(() =>
      crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        new TextEncoder().encode(destination)
      )
    )
    return `v1.${bytesHex(iv.buffer)}.${bytesHex(ciphertext)}`
  })
const decryptDestination = (secret: string, protectedValue: string) =>
  Effect.tryPromise({
    try: async () => {
      const [version, ivHex, ciphertextHex] = protectedValue.split('.')
      if (version !== 'v1' || !ivHex || !ciphertextHex) throw new Error('bad envelope')
      const key = await Effect.runPromise(encryptionKey(secret))
      const clear = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromHex(ivHex) },
        key,
        fromHex(ciphertextHex)
      )
      return new TextDecoder().decode(clear)
    },
    catch: () =>
      new CapabilityUnavailable({
        capability: 'appointment-email',
        reason: 'destination_reveal_failed'
      })
  })

const mutationStatements = Symbol('appointment-email-mutation-statements')
export type PreparedAppointmentEmailMutation = {
  readonly intentId: string
  readonly wakeup: AppointmentEmailWakeup
  readonly [mutationStatements]: readonly BatchStatement[]
}
export const appointmentEmailMutationStatements = (
  prepared: PreparedAppointmentEmailMutation
) => prepared[mutationStatements]

export type PrepareAppointmentEmailInput = {
  readonly merchantId: string
  readonly shopId: string
  readonly sourceType: 'appointment' | 'appointment_series' | 'booking_party'
  readonly sourceId: string
  readonly sourceRevision: number
  readonly appointmentIds: readonly string[]
  readonly purpose: AppointmentEmailPurpose
  readonly destination: string | null
  readonly locale: 'ro' | 'en'
  readonly facts: AppointmentEmailFacts
  readonly availableAt: string
  readonly usefulUntil?: string | undefined
  readonly createdAt: string
  readonly suppressionReason?: string | undefined
}

export const prepareAppointmentEmailMutation = (
  db: EffectDatabase,
  input: PrepareAppointmentEmailInput,
  protection?: NotificationDestinationProtectionSecrets
): Effect.Effect<PreparedAppointmentEmailMutation, CapabilityUnavailable> =>
  Effect.gen(function* () {
    const normalized = input.destination ? normalizeOwnerEmail(input.destination) : null
    const fingerprint =
      normalized && protection
        ? yield* hmac(protection.fingerprint, `email:${normalized}`)
        : null
    const destinationIdentity =
      fingerprint ??
      (normalized
        ? yield* digest([...input.appointmentIds].sort().join(':'))
        : 'no-destination')
    const semanticKey = [
      'appointment-email',
      input.sourceType,
      input.sourceId,
      input.sourceRevision,
      input.purpose,
      destinationIdentity
    ].join(':')
    const identity = yield* digest(semanticKey)
    const intentId = `aem_${identity.slice(-24)}`
    const factsFingerprint = yield* digest(JSON.stringify(input.facts))
    const ciphertext =
      normalized && protection
        ? yield* encryptDestination(protection.encryption, normalized)
        : null
    const status = input.suppressionReason
      ? ('suppressed' as const)
      : normalized && protection
        ? ('pending' as const)
        : ('unavailable' as const)
    const reason = input.suppressionReason
      ? 'merchant_dont_notify'
      : !normalized
        ? 'no_eligible_destination'
        : protection
          ? null
          : 'destination_protection_unavailable'
    const terminal = status === 'pending' ? null : input.createdAt
    const statement = db
      .insert(appointmentEmailIntents)
      .values({
        id: intentId,
        merchantId: input.merchantId,
        shopId: input.shopId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceRevision: input.sourceRevision,
        appointmentIdsJson: [...input.appointmentIds],
        purpose: input.purpose,
        semanticKey,
        locale: input.locale,
        templateKey: appointmentEmailTemplateKey(input.locale, input.purpose),
        templateVersion: 1,
        destinationCiphertext: ciphertext,
        destinationKeyVersion: protection?.keyVersion ?? 0,
        destinationFingerprint: fingerprint,
        maskedDestination: normalized ? maskEmail(normalized) : null,
        factsJson: input.facts,
        factsFingerprint,
        availableAt: input.availableAt,
        usefulUntil: input.usefulUntil ?? null,
        status,
        statusReason: reason,
        nextAttemptAt: status === 'pending' ? input.availableAt : null,
        terminalAt: terminal,
        createdAt: input.createdAt,
        updatedAt: input.createdAt
      })
      .onConflictDoNothing()
    return {
      intentId,
      wakeup: { version: 1, kind: 'appointment-email', intentId },
      [mutationStatements]: [statement]
    }
  })

export const supersedeAppointmentEmailMutations = (
  db: EffectDatabase,
  input: {
    readonly appointmentId: string
    readonly beforeRevision: number
    readonly now: string
  }
): readonly BatchStatement[] => [
  db
    .update(appointmentEmailIntents)
    .set({
      status: sql<AppointmentEmailStatus>`CASE
        WHEN ${appointmentEmailIntents.status} IN ('accepted', 'submission_unknown')
        THEN 'superseded_after_submission' ELSE 'superseded' END`,
      statusReason: sql<string>`CASE
        WHEN ${appointmentEmailIntents.status} IN ('accepted', 'submission_unknown')
        THEN 'source_revision_superseded_after_submission'
        ELSE 'source_revision_superseded' END`,
      terminalAt: input.now,
      nextAttemptAt: null,
      claimToken: null,
      claimedAt: null,
      updatedAt: input.now
    })
    .where(
      and(
        sql`EXISTS (SELECT 1 FROM json_each(${appointmentEmailIntents.appointmentIdsJson}) WHERE value = ${input.appointmentId})`,
        sql`${appointmentEmailIntents.sourceRevision} < ${input.beforeRevision}`,
        inArray(appointmentEmailIntents.status, [
          'pending',
          'claimed',
          'failed',
          'accepted',
          'submission_unknown'
        ])
      )
    )
]

const retryDelaysMs = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  4 * 60 * 60_000,
  12 * 60 * 60_000
] as const
const staleClaimMs = 5 * 60_000

export const AppointmentEmailSummary = Schema.Struct({
  intentId: Schema.String,
  purpose: AppointmentEmailPurpose,
  locale: Schema.Literals(['ro', 'en']),
  maskedDestination: Schema.NullOr(Schema.String),
  status: AppointmentEmailStatus,
  reason: Schema.NullOr(Schema.String),
  availableAt: Schema.String,
  acceptedAt: Schema.NullOr(Schema.String),
  deliveredAt: Schema.NullOr(Schema.String),
  lastAttemptAt: Schema.NullOr(Schema.String),
  attemptCount: Schema.Int,
  underReview: Schema.Boolean
})
export type AppointmentEmailSummary = typeof AppointmentEmailSummary.Type

export type AppointmentEmailWorkflowsShape = {
  readonly discoverDue: (input: {
    readonly now: string
    readonly limit?: number
  }) => Effect.Effect<readonly string[], CapabilityUnavailable>
  readonly execute: (input: {
    readonly intentId: string
    readonly now: string
  }) => Effect.Effect<void, CapabilityUnavailable>
  readonly summaries: (input: {
    readonly merchantId: string
    readonly appointmentId: string
  }) => Effect.Effect<readonly AppointmentEmailSummary[], CapabilityUnavailable>
}
export class AppointmentEmailWorkflows extends Context.Service<
  AppointmentEmailWorkflows,
  AppointmentEmailWorkflowsShape
>()('@b2b-saas-starter/capabilities/notifications/AppointmentEmailWorkflows') {}

export const readAppointmentEmailSummaries = (
  db: EffectDatabase,
  input: { readonly merchantId: string; readonly appointmentId: string }
) =>
  orUnavailable('appointment-email')(
    db
      .select({
        intentId: appointmentEmailIntents.id,
        purpose: appointmentEmailIntents.purpose,
        locale: appointmentEmailIntents.locale,
        maskedDestination: appointmentEmailIntents.maskedDestination,
        status: appointmentEmailIntents.status,
        reason: appointmentEmailIntents.statusReason,
        availableAt: appointmentEmailIntents.availableAt,
        acceptedAt: appointmentEmailIntents.acceptedAt,
        deliveredAt: appointmentEmailIntents.deliveredAt,
        lastAttemptAt: sql<string | null>`(
          SELECT max(a.started_at) FROM appointment_email_attempts a
          WHERE a.intent_id = ${appointmentEmailIntents.id}
        )`,
        attemptCount: appointmentEmailIntents.attemptCount,
        underReview: sql<boolean>`EXISTS (SELECT 1 FROM appointment_email_attention a WHERE a.intent_id = ${appointmentEmailIntents.id} AND a.status = 'open')`
      })
      .from(appointmentEmailIntents)
      .where(
        and(
          eq(appointmentEmailIntents.merchantId, input.merchantId),
          sql`EXISTS (SELECT 1 FROM json_each(${appointmentEmailIntents.appointmentIdsJson}) WHERE value = ${input.appointmentId})`
        )
      )
      .orderBy(asc(appointmentEmailIntents.createdAt), asc(appointmentEmailIntents.id))
  )

const terminalAttempt = (result: EmailProviderSubmission) =>
  result._tag === 'submission_unknown' ||
  (result._tag === 'failed' && !result.retryable)

export const makeLiveAppointmentEmailWorkflows = (input: {
  readonly provider: TransactionalEmailProvider
  readonly destinationEncryptionSecret?: string | undefined
  readonly confirmationSigningKeys?: Readonly<Record<string, string>> | undefined
  readonly publicOrigin?: string | undefined
}): Layer.Layer<AppointmentEmailWorkflows, never, Database> =>
  Layer.effect(
    AppointmentEmailWorkflows,
    Effect.gen(function* () {
      const db = yield* Database
      const raw = rawD1FromDatabase(db)
      const unavailable = orUnavailable('appointment-email')

      const finalize = (params: {
        readonly intent: typeof appointmentEmailIntents.$inferSelect
        readonly attemptId: string
        readonly ordinal: number
        readonly now: string
        readonly result: EmailProviderSubmission
      }) =>
        Effect.tryPromise({
          try: async () => {
            const result = params.result
            const isRetry = result._tag === 'failed' && result.retryable
            const retryDelay = retryDelaysMs[params.ordinal - 1]
            const proposedRetry = retryDelay
              ? new Date(Date.parse(params.now) + retryDelay).toISOString()
              : null
            const retryUseful =
              isRetry &&
              proposedRetry &&
              (!params.intent.usefulUntil || proposedRetry < params.intent.usefulUntil)
            const terminal = terminalAttempt(result) || (isRetry && !retryUseful)
            const status =
              result._tag === 'captured'
                ? 'captured'
                : result._tag === 'accepted'
                  ? 'accepted'
                  : result._tag === 'submission_unknown'
                    ? 'submission_unknown'
                    : retryUseful
                      ? 'failed'
                      : 'failed'
            const attemptState =
              result._tag === 'captured'
                ? 'captured'
                : result._tag === 'accepted'
                  ? 'accepted'
                  : result._tag === 'submission_unknown'
                    ? 'submission_unknown'
                    : retryUseful
                      ? 'failed_retryable'
                      : 'failed_terminal'
            const failureCode =
              result._tag === 'failed' || result._tag === 'submission_unknown'
                ? result.code
                : null
            const statements = [
              raw
                .prepare(
                  `UPDATE appointment_email_attempts SET state = ?, failure_code = ?, completed_at = ?
                   WHERE id = ? AND state = 'submitting'`
                )
                .bind(attemptState, failureCode, params.now, params.attemptId),
              raw
                .prepare(
                  `UPDATE appointment_email_intents SET status = ?, status_reason = ?,
                   next_attempt_at = ?, claimed_at = NULL, claim_token = NULL,
                   provider_reference_fingerprint = ?, accepted_at = ?, terminal_at = ?, updated_at = ?
                   WHERE id = ? AND claim_token = ? AND status = 'claimed'`
                )
                .bind(
                  status,
                  failureCode,
                  retryUseful ? proposedRetry : null,
                  result._tag === 'accepted'
                    ? result.providerReferenceFingerprint
                    : null,
                  result._tag === 'accepted' ? result.acceptedAt : null,
                  terminal || result._tag === 'captured' ? params.now : null,
                  params.now,
                  params.intent.id,
                  params.intent.claimToken
                )
            ]
            if (terminal && result._tag !== 'captured') {
              statements.push(
                raw
                  .prepare(
                    `INSERT OR IGNORE INTO appointment_email_dead_letters
                     (id, intent_id, merchant_id, safe_reason, created_at) VALUES (?, ?, ?, ?, ?)`
                  )
                  .bind(
                    `aed_${params.intent.id.slice(-24)}`,
                    params.intent.id,
                    params.intent.merchantId,
                    failureCode ?? 'retries_exhausted',
                    params.now
                  )
              )
              statements.push(
                raw
                  .prepare(
                    `INSERT OR IGNORE INTO appointment_email_attention
                     (id, intent_id, merchant_id, kind, status, safe_summary, opened_at)
                     VALUES (?, ?, ?, ?, 'open', ?, ?)`
                  )
                  .bind(
                    `aea_${params.intent.id.slice(-24)}`,
                    params.intent.id,
                    params.intent.merchantId,
                    result._tag === 'submission_unknown'
                      ? 'submission_unknown'
                      : 'delivery_failed',
                    result._tag === 'submission_unknown'
                      ? 'Email submission requires reconciliation.'
                      : 'Appointment email delivery failed.',
                    params.now
                  )
              )
            }
            await raw.batch(statements)
            if (result._tag === 'accepted') {
              const pending = await raw
                .prepare(
                  `SELECT event_id eventId, provider_status providerStatus,
                          provider_occurred_at providerOccurredAt,
                          normalized_code normalizedCode, received_at receivedAt
                   FROM transactional_email_callback_receipts
                   WHERE provider_reference_fingerprint = ? AND outcome = 'pending'
                   ORDER BY provider_occurred_at ASC, event_id ASC`
                )
                .bind(result.providerReferenceFingerprint)
                .all<{
                  eventId: string
                  providerStatus: 'delivered' | 'failed'
                  providerOccurredAt: string
                  normalizedCode: string | null
                  receivedAt: string
                }>()
              for (const callback of pending.results) {
                await raw.batch([
                  raw
                    .prepare(
                      `UPDATE appointment_email_intents SET status = ?, delivered_at = ?,
                       status_reason = ?, latest_provider_occurred_at = ?, terminal_at = ?,
                       updated_at = ? WHERE id = ? AND status IN ('accepted','delivered','failed')
                       AND (latest_provider_occurred_at IS NULL OR latest_provider_occurred_at < ?)`
                    )
                    .bind(
                      callback.providerStatus === 'delivered' ? 'delivered' : 'failed',
                      callback.providerStatus === 'delivered'
                        ? callback.providerOccurredAt
                        : null,
                      callback.providerStatus === 'failed'
                        ? (callback.normalizedCode ?? 'provider_failed')
                        : null,
                      callback.providerOccurredAt,
                      callback.providerOccurredAt,
                      callback.providerOccurredAt,
                      params.intent.id,
                      callback.providerOccurredAt
                    ),
                  raw
                    .prepare(
                      `INSERT OR IGNORE INTO appointment_email_callback_receipts
                       (event_fingerprint, intent_id, provider_reference_fingerprint,
                        provider_status, provider_occurred_at, normalized_code, outcome, received_at)
                       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`
                    )
                    .bind(
                      callback.eventId,
                      params.intent.id,
                      result.providerReferenceFingerprint,
                      callback.providerStatus,
                      callback.providerOccurredAt,
                      callback.normalizedCode,
                      callback.receivedAt
                    ),
                  raw
                    .prepare(
                      `UPDATE appointment_email_callback_receipts SET outcome = CASE
                       WHEN EXISTS (SELECT 1 FROM appointment_email_intents
                         WHERE id = ? AND latest_provider_occurred_at = ?)
                       THEN 'applied' ELSE 'out_of_order' END
                       WHERE event_fingerprint = ?`
                    )
                    .bind(
                      params.intent.id,
                      callback.providerOccurredAt,
                      callback.eventId
                    ),
                  raw
                    .prepare(
                      `UPDATE transactional_email_callback_receipts SET outcome = CASE
                       WHEN EXISTS (SELECT 1 FROM appointment_email_intents
                         WHERE id = ? AND latest_provider_occurred_at = ?)
                       THEN 'applied' ELSE 'out_of_order' END
                       WHERE event_id = ?`
                    )
                    .bind(
                      params.intent.id,
                      callback.providerOccurredAt,
                      callback.eventId
                    )
                ])
              }
            }
          },
          catch: () =>
            new CapabilityUnavailable({
              capability: 'appointment-email',
              reason: 'intent_finalize_unavailable'
            })
        })

      return {
        discoverDue: ({ now, limit = 1000 }) =>
          Effect.gen(function* () {
            const staleAt = new Date(Date.parse(now) - staleClaimMs).toISOString()
            // A stale claim with a write-ahead attempt crossed the I/O boundary and
            // is ambiguous. A stale claim without one is safe to make pending again.
            yield* Effect.tryPromise({
              try: async () => {
                await raw.batch([
                  raw
                    .prepare(
                      `UPDATE appointment_email_attempts SET state = 'submission_unknown',
                       failure_code = 'stale_submission_claim', completed_at = ?
                       WHERE state = 'submitting' AND started_at < ?`
                    )
                    .bind(now, staleAt),
                  raw
                    .prepare(
                      `UPDATE appointment_email_intents SET status = 'submission_unknown',
                       status_reason = 'stale_submission_claim', terminal_at = ?,
                       claimed_at = NULL, claim_token = NULL, next_attempt_at = NULL, updated_at = ?
                       WHERE status = 'claimed' AND claimed_at < ?
                         AND EXISTS (SELECT 1 FROM appointment_email_attempts a
                           WHERE a.intent_id = appointment_email_intents.id
                             AND a.state = 'submission_unknown')`
                    )
                    .bind(now, now, staleAt),
                  raw
                    .prepare(
                      `UPDATE appointment_email_intents SET status = 'pending', claimed_at = NULL,
                       claim_token = NULL, updated_at = ? WHERE status = 'claimed' AND claimed_at < ?
                       AND NOT EXISTS (SELECT 1 FROM appointment_email_attempts a
                         WHERE a.intent_id = appointment_email_intents.id)`
                    )
                    .bind(now, staleAt),
                  raw
                    .prepare(
                      `INSERT OR IGNORE INTO appointment_email_dead_letters
                       (id, intent_id, merchant_id, safe_reason, created_at)
                       SELECT 'aed_' || substr(id, -24), id, merchant_id,
                              'stale_submission_claim', ?
                       FROM appointment_email_intents
                       WHERE status = 'submission_unknown'
                         AND status_reason = 'stale_submission_claim'`
                    )
                    .bind(now),
                  raw
                    .prepare(
                      `INSERT OR IGNORE INTO appointment_email_attention
                       (id, intent_id, merchant_id, kind, status, safe_summary, opened_at)
                       SELECT 'aea_' || substr(id, -24), id, merchant_id,
                              'submission_unknown', 'open',
                              'Email submission requires reconciliation.', ?
                       FROM appointment_email_intents
                       WHERE status = 'submission_unknown'
                         AND status_reason = 'stale_submission_claim'`
                    )
                    .bind(now)
                ])
              },
              catch: () =>
                new CapabilityUnavailable({
                  capability: 'appointment-email',
                  reason: 'recovery_sweep_unavailable'
                })
            })
            const rows = yield* unavailable(
              db
                .select({ id: appointmentEmailIntents.id })
                .from(appointmentEmailIntents)
                .where(
                  and(
                    inArray(appointmentEmailIntents.status, ['pending', 'failed']),
                    lte(appointmentEmailIntents.availableAt, now),
                    or(
                      isNull(appointmentEmailIntents.nextAttemptAt),
                      lte(appointmentEmailIntents.nextAttemptAt, now)
                    ),
                    or(
                      isNull(appointmentEmailIntents.usefulUntil),
                      sql`${appointmentEmailIntents.usefulUntil} > ${now}`
                    )
                  )
                )
                .orderBy(
                  asc(appointmentEmailIntents.availableAt),
                  asc(appointmentEmailIntents.id)
                )
                .limit(Math.min(Math.max(limit, 1), 1000))
            )
            return rows.map((row) => row.id)
          }),
        execute: ({ intentId, now }) =>
          Effect.gen(function* () {
            const claimToken = crypto.randomUUID()
            const claimed = yield* unavailable(
              db
                .update(appointmentEmailIntents)
                .set({ status: 'claimed', claimedAt: now, claimToken, updatedAt: now })
                .where(
                  and(
                    eq(appointmentEmailIntents.id, intentId),
                    inArray(appointmentEmailIntents.status, ['pending', 'failed']),
                    lte(appointmentEmailIntents.availableAt, now),
                    or(
                      isNull(appointmentEmailIntents.nextAttemptAt),
                      lte(appointmentEmailIntents.nextAttemptAt, now)
                    )
                  )
                )
                .returning()
            )
            const intent = claimed[0]
            if (!intent) return
            if (intent.usefulUntil && intent.usefulUntil <= now) {
              yield* unavailable(
                db
                  .update(appointmentEmailIntents)
                  .set({
                    status: 'superseded',
                    statusReason: 'useful_lifetime_expired',
                    terminalAt: now,
                    claimToken: null,
                    claimedAt: null,
                    nextAttemptAt: null,
                    updatedAt: now
                  })
                  .where(
                    and(
                      eq(appointmentEmailIntents.id, intent.id),
                      eq(appointmentEmailIntents.claimToken, claimToken)
                    )
                  )
              )
              return
            }
            if (
              input.provider.state === 'needs_configuration' ||
              input.provider.state === 'disabled' ||
              !input.destinationEncryptionSecret ||
              !intent.destinationCiphertext
            ) {
              const reason =
                input.provider.state === 'disabled'
                  ? 'email_disabled'
                  : input.provider.state === 'needs_configuration'
                    ? 'email_needs_configuration'
                    : 'destination_protection_unavailable'
              yield* unavailable(
                db
                  .update(appointmentEmailIntents)
                  .set({
                    status: 'unavailable',
                    statusReason: reason,
                    terminalAt: now,
                    claimToken: null,
                    claimedAt: null,
                    nextAttemptAt: null,
                    updatedAt: now
                  })
                  .where(
                    and(
                      eq(appointmentEmailIntents.id, intent.id),
                      eq(appointmentEmailIntents.claimToken, claimToken)
                    )
                  )
              )
              return
            }
            const factsResult = yield* Effect.result(
              Schema.decodeUnknownEffect(AppointmentEmailFacts)(intent.factsJson)
            )
            if (factsResult._tag === 'Failure') {
              yield* unavailable(
                db
                  .update(appointmentEmailIntents)
                  .set({
                    status: 'unavailable',
                    statusReason: 'invalid_immutable_facts',
                    terminalAt: now,
                    claimToken: null,
                    claimedAt: null,
                    nextAttemptAt: null,
                    updatedAt: now
                  })
                  .where(
                    and(
                      eq(appointmentEmailIntents.id, intent.id),
                      eq(appointmentEmailIntents.claimToken, claimToken)
                    )
                  )
              )
              return
            }
            const facts = factsResult.success
            if (facts.confirmationAccess && !input.publicOrigin) {
              yield* unavailable(
                db
                  .update(appointmentEmailIntents)
                  .set({
                    status: 'unavailable',
                    statusReason: 'confirmation_public_origin_unavailable',
                    terminalAt: now,
                    claimToken: null,
                    claimedAt: null,
                    nextAttemptAt: null,
                    updatedAt: now
                  })
                  .where(
                    and(
                      eq(appointmentEmailIntents.id, intent.id),
                      eq(appointmentEmailIntents.claimToken, claimToken)
                    )
                  )
              )
              return
            }
            const confirmationUrlResult = facts.confirmationAccess
              ? yield* Effect.result(
                  Effect.promise(() =>
                    deriveConfirmationUrl(
                      facts.confirmationAccess!,
                      input.confirmationSigningKeys ?? {},
                      input.publicOrigin!
                    )
                  )
                )
              : null
            if (confirmationUrlResult?._tag === 'Failure') {
              yield* unavailable(
                db
                  .update(appointmentEmailIntents)
                  .set({
                    status: 'unavailable',
                    statusReason: 'confirmation_signing_key_unavailable',
                    terminalAt: now,
                    claimToken: null,
                    claimedAt: null,
                    nextAttemptAt: null,
                    updatedAt: now
                  })
                  .where(
                    and(
                      eq(appointmentEmailIntents.id, intent.id),
                      eq(appointmentEmailIntents.claimToken, claimToken)
                    )
                  )
              )
              return
            }
            const confirmationUrl =
              confirmationUrlResult?._tag === 'Success'
                ? confirmationUrlResult.success
                : undefined
            const ordinal = intent.attemptCount + 1
            const attemptId = `aep_${intent.id.slice(-20)}_${ordinal}`
            const idempotencyKey = `${intent.semanticKey}:attempt:${ordinal}`
            const fenced = yield* Effect.tryPromise({
              try: () =>
                raw.batch([
                  raw
                    .prepare(
                      `INSERT OR IGNORE INTO appointment_email_attempts
                       (id, intent_id, ordinal, idempotency_key, state, started_at, created_at)
                       SELECT ?, ?, ?, ?, 'submitting', ?, ?
                       WHERE EXISTS (
                         SELECT 1 FROM appointment_email_intents
                         WHERE id = ? AND claim_token = ? AND status = 'claimed'
                       )`
                    )
                    .bind(
                      attemptId,
                      intent.id,
                      ordinal,
                      idempotencyKey,
                      now,
                      now,
                      intent.id,
                      claimToken
                    ),
                  raw
                    .prepare(
                      `UPDATE appointment_email_intents SET attempt_count = ?, updated_at = ?
                       WHERE id = ? AND claim_token = ? AND status = 'claimed'`
                    )
                    .bind(ordinal, now, intent.id, claimToken)
                ]),
              catch: () =>
                new CapabilityUnavailable({
                  capability: 'appointment-email',
                  reason: 'attempt_persistence_unavailable'
                })
            })
            if ((fenced[1]?.meta.changes ?? 0) !== 1) return
            const destination = yield* decryptDestination(
              input.destinationEncryptionSecret,
              intent.destinationCiphertext
            )
            const rendered = renderAppointmentEmail({
              locale: intent.locale,
              purpose: intent.purpose,
              facts,
              confirmationUrl
            })
            const submissionFence = yield* Effect.tryPromise({
              try: () =>
                raw
                  .prepare(
                    `UPDATE appointment_email_intents SET updated_at = ?
                     WHERE id = ? AND claim_token = ? AND status = 'claimed'`
                  )
                  .bind(now, intent.id, claimToken)
                  .run(),
              catch: () =>
                new CapabilityUnavailable({
                  capability: 'appointment-email',
                  reason: 'submission_fence_unavailable'
                })
            })
            if ((submissionFence.meta.changes ?? 0) !== 1) {
              yield* Effect.tryPromise({
                try: () =>
                  raw
                    .prepare(
                      `UPDATE appointment_email_attempts
                       SET state = 'failed_terminal', failure_code = 'source_revision_superseded',
                           completed_at = ? WHERE id = ? AND state = 'submitting'`
                    )
                    .bind(now, attemptId)
                    .run(),
                catch: () =>
                  new CapabilityUnavailable({
                    capability: 'appointment-email',
                    reason: 'superseded_attempt_finalize_unavailable'
                  })
              })
              return
            }
            const submission = yield* Effect.result(
              input.provider.submit({
                idempotencyKey,
                from: input.provider.sender ?? '',
                to: destination,
                subject: rendered.subject,
                text: rendered.text,
                locale: intent.locale,
                templateKey: intent.templateKey
              })
            )
            yield* finalize({
              intent: { ...intent, claimToken },
              attemptId,
              ordinal,
              now,
              result:
                submission._tag === 'Success'
                  ? submission.success
                  : {
                      _tag: 'submission_unknown',
                      code: 'provider_request_failed'
                    }
            })
          }),
        summaries: (summaryInput) => readAppointmentEmailSummaries(db, summaryInput)
      }
    })
  )

export const SeedAppointmentEmailWorkflows: Layer.Layer<AppointmentEmailWorkflows> =
  Layer.succeed(AppointmentEmailWorkflows)({
    discoverDue: () => Effect.succeed([]),
    execute: () => Effect.void,
    summaries: () => Effect.succeed([])
  })
