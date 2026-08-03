import { Database } from '@b2b-saas-starter/db'
import { Effect, Schema } from 'effect'
import { CapabilityUnavailable } from '../errors.ts'
import { NotificationIntentLifecycle } from './notification-intent-lifecycle.ts'
import {
  classifyMetaError,
  classifyMetaPricing,
  fingerprintMetaReference,
  metaErrorPolicyVersion
} from './meta-whatsapp.ts'

const MetaPricingPayload = Schema.Struct({
  billable: Schema.Boolean,
  pricing_model: Schema.String,
  category: Schema.optional(Schema.String)
})
const MetaStatusPayload = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
  timestamp: Schema.String,
  pricing: Schema.optional(MetaPricingPayload),
  errors: Schema.optional(
    Schema.Array(
      Schema.Struct({
        code: Schema.Number
      })
    )
  )
})
const MetaCallbackPayload = Schema.Struct({
  object: Schema.Literal('whatsapp_business_account'),
  entry: Schema.Array(
    Schema.Struct({
      changes: Schema.Array(
        Schema.Struct({
          field: Schema.String,
          value: Schema.Struct({
            statuses: Schema.optional(Schema.Array(MetaStatusPayload))
          })
        })
      )
    })
  )
})

export type MetaCallbackEvent = {
  readonly providerReference: string
  readonly status:
    | 'accepted'
    | 'delivered'
    | 'read'
    | 'terminal_failure'
    | 'rejected_retryable'
    | 'submission_unknown'
  readonly providerOccurredAt: string
  readonly sourceEventKey: string
  readonly errorCode?: number
  readonly errorPolicyVersion?: string
  readonly pricing?: ReturnType<typeof classifyMetaPricing>
}

export class MetaCallbackRejected extends Schema.TaggedErrorClass<MetaCallbackRejected>()(
  'MetaCallbackRejected',
  { reason: Schema.Literal('malformed_callback') }
) {}

export const decodeMetaCallbackEvents = (
  raw: string,
  receivedAt: string
): Effect.Effect<readonly MetaCallbackEvent[], MetaCallbackRejected> =>
  Effect.gen(function* () {
    const json = yield* Effect.try({
      try: () => JSON.parse(raw) as unknown,
      catch: () => new MetaCallbackRejected({ reason: 'malformed_callback' })
    })
    const payload = yield* Schema.decodeUnknownEffect(MetaCallbackPayload)(json).pipe(
      Effect.mapError(() => new MetaCallbackRejected({ reason: 'malformed_callback' }))
    )
    const events: MetaCallbackEvent[] = []
    for (const entry of payload.entry)
      for (const change of entry.changes) {
        if (change.field !== 'messages') continue
        for (const status of change.value.statuses ?? []) {
          if (
            !status.id.startsWith('wamid.') ||
            status.id.length > 512 ||
            !/^\d{1,12}$/.test(status.timestamp)
          )
            return yield* new MetaCallbackRejected({ reason: 'malformed_callback' })
          const providerOccurredAt = new Date(
            Number(status.timestamp) * 1_000
          ).toISOString()
          const common = {
            providerReference: status.id,
            providerOccurredAt,
            sourceEventKey: `${status.id}:${status.status}:${status.timestamp}:${status.errors?.[0]?.code ?? 'none'}`,
            pricing: classifyMetaPricing(status.pricing, receivedAt)
          }
          if (status.status === 'sent') events.push({ ...common, status: 'accepted' })
          else if (status.status === 'delivered')
            events.push({ ...common, status: 'delivered' })
          else if (status.status === 'read') events.push({ ...common, status: 'read' })
          else if (status.status === 'failed') {
            const errorCode = status.errors?.[0]?.code
            const classification =
              errorCode === undefined ? null : classifyMetaError(errorCode, receivedAt)
            const errorPolicyVersion =
              classification?.policyVersion ??
              metaErrorPolicyVersion(receivedAt) ??
              undefined
            events.push({
              ...common,
              status:
                classification?.classification === 'terminal'
                  ? 'terminal_failure'
                  : classification?.classification === 'retryable'
                    ? 'rejected_retryable'
                    : 'submission_unknown',
              ...(errorPolicyVersion === undefined ? {} : { errorPolicyVersion }),
              ...(errorCode === undefined ? {} : { errorCode })
            })
          }
        }
      }
    return events
  })

const unavailable = (reason: unknown) =>
  new CapabilityUnavailable({
    capability: 'meta-whatsapp-callback',
    reason: reason instanceof Error ? reason.message : String(reason)
  })

const tryDb = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({ try: operation, catch: unavailable })

const safeId = (prefix: string, value: string) =>
  Effect.promise(async () => {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(value)
    )
    return `${prefix}_${[...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 40)}`
  })

export const captureMetaCallbackReceipt = (input: {
  readonly environment: string
  readonly providerAccountKey: string
  readonly rawBodyDigest: string
  readonly receivedAt: string
  readonly byteLength: number
  readonly eventCount: number
}) =>
  Effect.gen(function* () {
    const db = yield* Database
    const id = yield* safeId(
      'pcr',
      `${input.environment}:${input.providerAccountKey}:${input.rawBodyDigest}`
    )
    const result = yield* tryDb(() =>
      db.$client.config.db
        .prepare(
          `INSERT OR IGNORE INTO provider_callback_receipts
           (id, environment, provider, provider_account_key, raw_body_digest,
            byte_length, event_count, received_at, created_at)
           VALUES (?, ?, 'meta', ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          id,
          input.environment,
          input.providerAccountKey,
          input.rawBodyDigest,
          input.byteLength,
          input.eventCount,
          input.receivedAt,
          input.receivedAt
        )
        .run()
    )
    if (!result.success)
      return yield* Effect.fail(unavailable('receipt persistence failed'))
  })

export const ingestMetaCallbackEvents = (input: {
  readonly events: readonly MetaCallbackEvent[]
  readonly receivedAt: string
  readonly environment: string
  readonly providerAccountKey: string
  readonly fingerprintSecret: string
}) =>
  Effect.gen(function* () {
    const db = yield* Database
    const lifecycle = yield* NotificationIntentLifecycle
    const raw = db.$client.config.db
    const intentIds: string[] = []
    let unresolvedCount = 0
    for (const event of input.events) {
      const fingerprint = yield* Effect.promise(() =>
        fingerprintMetaReference(event.providerReference, input.fingerprintSecret)
      )
      const correlation = yield* tryDb(() =>
        raw
          .prepare(
            `SELECT sa.intent_id, sa.id AS attempt_id
             FROM protected_provider_references ppr
             JOIN submission_attempts sa ON sa.id = ppr.attempt_id
             WHERE ppr.environment = ? AND ppr.provider = 'meta'
               AND ppr.provider_account_key = ? AND ppr.reference_type = 'message_id'
               AND ppr.fingerprint = ? AND ppr.erased_at IS NULL
             LIMIT 1`
          )
          .bind(input.environment, input.providerAccountKey, fingerprint)
          .first<{ intent_id: string; attempt_id: string }>()
      )
      if (!correlation) {
        unresolvedCount += 1
        continue
      }
      yield* lifecycle.ingestEvidence({
        id: yield* safeId('pevd_meta', event.sourceEventKey),
        intentId: correlation.intent_id,
        attemptId: correlation.attempt_id,
        environment: input.environment,
        providerAccountKey: input.providerAccountKey,
        source: 'callback',
        sourceEventKey: event.sourceEventKey,
        providerReferenceFingerprint: fingerprint,
        status: event.status,
        trusted: true,
        ...(event.status === 'terminal_failure'
          ? {
              normalizedCode: 'provider_terminal_failure',
              ...(event.errorPolicyVersion
                ? { classificationPolicyVersion: event.errorPolicyVersion }
                : {}),
              ...(event.errorCode === undefined
                ? {}
                : { providerCode: event.errorCode })
            }
          : event.status === 'rejected_retryable'
            ? {
                normalizedCode: 'provider_transport_error',
                ...(event.errorPolicyVersion
                  ? { classificationPolicyVersion: event.errorPolicyVersion }
                  : {}),
                ...(event.errorCode === undefined
                  ? {}
                  : { providerCode: event.errorCode })
              }
            : event.status === 'submission_unknown'
              ? {
                  normalizedCode: 'malformed_provider_evidence',
                  ...(event.errorPolicyVersion
                    ? { classificationPolicyVersion: event.errorPolicyVersion }
                    : {}),
                  ...(event.errorCode === undefined
                    ? {}
                    : { providerCode: event.errorCode })
                }
              : {}),
        ...(event.pricing
          ? {
              pricingPolicyVersion: event.pricing.policyVersion,
              providerBillable: event.pricing.billable,
              providerPricingCategory: event.pricing.category,
              providerPricingModel: event.pricing.pricingModel
            }
          : {}),
        providerOccurredAt: event.providerOccurredAt,
        observedAt: input.receivedAt
      })
      intentIds.push(correlation.intent_id)
    }
    return { intentIds, unresolvedCount }
  })
