import { Effect, Redacted } from 'effect'
import { layerFromD1 } from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import type { NotificationIntentLifecycleShape } from './notification-intent-lifecycle.ts'
import { verifySmsoCallbackHint, type SmsoAdapter } from './smso-adapter.ts'
import { pollSmsoStatuses, type SmsoPollingCandidate } from './smso-polling.ts'

type AcceptanceInput = {
  readonly shopId: string
  readonly intentId: string
  readonly attemptId: string
  readonly provider: 'meta' | 'smso'
  readonly providerAccountKey: string
  readonly providerReferenceFingerprint: string
  readonly protectedProviderReference?: Redacted.Redacted<string>
  readonly costFacts: readonly {
    readonly amountMilliEuro: number
    readonly units: number
    readonly recordedAt: string
  }[]
  readonly acceptedAt: string
}

type SmsoD1 = Parameters<typeof layerFromD1>[0]
type SmsoD1Statement = ReturnType<SmsoD1['prepare']>
type SmsoReadStatement = {
  readonly bind: (...values: unknown[]) => SmsoReadStatement
  readonly all: <T>() => Promise<{ readonly results: readonly T[] }>
}
type SmsoReadD1 = { readonly prepare: (sql: string) => SmsoReadStatement }

const base64 = (value: Uint8Array) => {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const unavailable = (reason: unknown) =>
  new CapabilityUnavailable({
    capability: 'smso-provider-acceptance',
    reason: reason instanceof Error ? reason.message : String(reason)
  })

const encryptReference = async (secret: string, reference: string) => {
  const material = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(
      `booking-operational-messaging:provider-reference:smso:${secret}`
    )
  )
  const key = await crypto.subtle.importKey('raw', material, 'AES-GCM', false, [
    'encrypt'
  ])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(reference)
    )
  )
  const envelope = new Uint8Array(iv.length + ciphertext.length)
  envelope.set(iv)
  envelope.set(ciphertext, iv.length)
  return base64(envelope)
}

export const makeLiveProviderAcceptancePersistence =
  (options: {
    readonly db: SmsoD1
    readonly environment: string
    readonly encryptionSecret: string
    readonly keyVersion: number
  }) =>
  (input: AcceptanceInput): Effect.Effect<void, CapabilityUnavailable> =>
    Effect.tryPromise({
      try: async () => {
        if (input.provider !== 'smso' || !input.protectedProviderReference) return
        const reference = Redacted.value(input.protectedProviderReference)
        const ciphertext = await encryptReference(options.encryptionSecret, reference)
        const statements: SmsoD1Statement[] = [
          options.db
            .prepare(
              `INSERT OR IGNORE INTO protected_provider_references
             (id, shop_id, attempt_id, environment, provider, provider_account_key,
              reference_type, ciphertext, key_version, fingerprint, masked_suffix,
              created_at, erased_at)
             VALUES (?, ?, ?, ?, 'smso', ?, 'response_token', ?, ?, ?, ?, ?, NULL)`
            )
            .bind(
              `ppr_${input.attemptId}`,
              input.shopId,
              input.attemptId,
              options.environment,
              input.providerAccountKey,
              ciphertext,
              options.keyVersion,
              input.providerReferenceFingerprint,
              reference.slice(-4),
              input.acceptedAt
            )
        ]
        for (const [ordinal, cost] of input.costFacts.entries())
          statements.push(
            options.db
              .prepare(
                `INSERT OR IGNORE INTO provider_messaging_costs
                 (id, shop_id, intent_id, attempt_id, environment, provider,
                  provider_account_key, billing_identity_fingerprint, unit_ordinal,
                  amount_minor_units, currency, currency_scale, units, source,
                  recorded_at, created_at)
                 SELECT ?, ?, ?, ?, ?, 'smso', ?, ?, ?, ?, 'EUR', 3, ?, 'response', ?, ?
                 WHERE EXISTS (
                   SELECT 1 FROM protected_provider_references
                   WHERE attempt_id = ? AND reference_type = 'response_token'
                     AND fingerprint = ? AND erased_at IS NULL
                 )`
              )
              .bind(
                `pcst_${input.attemptId}_${ordinal}`,
                input.shopId,
                input.intentId,
                input.attemptId,
                options.environment,
                input.providerAccountKey,
                input.providerReferenceFingerprint,
                ordinal,
                cost.amountMilliEuro,
                cost.units,
                cost.recordedAt,
                cost.recordedAt,
                input.attemptId,
                input.providerReferenceFingerprint
              )
          )
        await options.db.batch(statements)
        const correlation = await options.db
          .prepare(
            `SELECT attempt_id, fingerprint
             FROM protected_provider_references
             WHERE reference_type = 'response_token' AND erased_at IS NULL
               AND ((attempt_id = ?) OR
                 (environment = ? AND provider = 'smso' AND provider_account_key = ?
                  AND fingerprint = ?))
             LIMIT 3`
          )
          .bind(
            input.attemptId,
            options.environment,
            input.providerAccountKey,
            input.providerReferenceFingerprint
          )
          .all<{ readonly attempt_id: string; readonly fingerprint: string }>()
        if (
          correlation.results.length !== 1 ||
          correlation.results[0]?.attempt_id !== input.attemptId ||
          correlation.results[0]?.fingerprint !== input.providerReferenceFingerprint
        )
          throw new Error('provider_reference_collision')
      },
      catch: unavailable
    })

export const decryptSmsoProviderReference = (input: {
  readonly ciphertext: string
  readonly encryptionSecret: string
}) =>
  Effect.tryPromise({
    try: async () => {
      const binary = atob(input.ciphertext)
      const envelope = Uint8Array.from(binary, (character) => character.charCodeAt(0))
      if (envelope.length <= 12) throw new Error('invalid provider reference envelope')
      const material = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(
          `booking-operational-messaging:provider-reference:smso:${input.encryptionSecret}`
        )
      )
      const key = await crypto.subtle.importKey('raw', material, 'AES-GCM', false, [
        'decrypt'
      ])
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: envelope.slice(0, 12) },
        key,
        envelope.slice(12)
      )
      return Redacted.make(new TextDecoder().decode(plaintext))
    },
    catch: unavailable
  })

export const pollLiveSmsoStatuses = (options: {
  readonly db: SmsoD1
  readonly adapter: SmsoAdapter
  readonly lifecycle: NotificationIntentLifecycleShape
  readonly environment: string
  readonly providerAccountKey: string
  readonly encryptionSecret: string
  readonly keyVersion: number
  readonly intentId?: string
  readonly limit?: number
}) =>
  pollSmsoStatuses({
    ...(options.limit === undefined ? {} : { limit: options.limit }),
    environment: options.environment,
    providerAccountKey: options.providerAccountKey,
    loadCandidates: (limit) =>
      Effect.tryPromise({
        try: async () => {
          const filter = options.intentId ? 'AND sa.intent_id = ?' : ''
          const statement = options.db.prepare(
            `SELECT sa.id AS attempt_id, sa.intent_id, ppr.fingerprint,
                    ppr.ciphertext, ppr.key_version
             FROM protected_provider_references ppr
             JOIN submission_attempts sa ON sa.id = ppr.attempt_id
             JOIN delivery_routes dr ON dr.id = sa.route_id
             WHERE ppr.environment = ? AND ppr.provider = 'smso'
               AND ppr.provider_account_key = ?
               AND ppr.reference_type = 'response_token'
               AND ppr.erased_at IS NULL AND ppr.ciphertext IS NOT NULL
               AND dr.state IN ('accepted', 'submission_unknown')
               ${filter}
             ORDER BY sa.started_at, sa.id
             LIMIT ?`
          )
          const bound = options.intentId
            ? statement.bind(
                options.environment,
                options.providerAccountKey,
                options.intentId,
                limit
              )
            : statement.bind(options.environment, options.providerAccountKey, limit)
          const rows = await bound.all<{
            readonly attempt_id: string
            readonly intent_id: string
            readonly fingerprint: string
            readonly ciphertext: string
            readonly key_version: number
          }>()
          return rows.results.map(
            (row): SmsoPollingCandidate => ({
              attemptId: row.attempt_id,
              intentId: row.intent_id,
              fingerprint: row.fingerprint,
              ciphertext: row.ciphertext,
              keyVersion: row.key_version
            })
          )
        },
        catch: unavailable
      }),
    revealReference: (candidate) =>
      candidate.keyVersion !== options.keyVersion
        ? Effect.fail(unavailable('provider reference key version unavailable'))
        : decryptSmsoProviderReference({
            ciphertext: candidate.ciphertext,
            encryptionSecret: options.encryptionSecret
          }),
    query: options.adapter.query,
    ingestEvidence: options.lifecycle.ingestEvidence
  })

export const acceptSmsoCallbackHint = <PublishError>(options: {
  readonly db: SmsoReadD1
  readonly environment: string
  readonly providerAccountKey: string
  readonly fingerprintSecret: string
  readonly rawBody: string
  readonly publishWakeup: (intentId: string) => Effect.Effect<void, PublishError>
}) =>
  Effect.gen(function* () {
    const hint = yield* verifySmsoCallbackHint({
      rawBody: options.rawBody,
      fingerprintSecret: Redacted.make(options.fingerprintSecret)
    })
    if (hint._tag === 'rejected') return hint
    const matches = yield* Effect.tryPromise({
      try: () =>
        options.db
          .prepare(
            `SELECT sa.intent_id
             FROM protected_provider_references ppr
             JOIN submission_attempts sa ON sa.id = ppr.attempt_id
             WHERE ppr.environment = ? AND ppr.provider = 'smso'
               AND ppr.provider_account_key = ?
               AND ppr.reference_type = 'response_token'
               AND ppr.fingerprint = ? AND ppr.erased_at IS NULL
             LIMIT 2`
          )
          .bind(
            options.environment,
            options.providerAccountKey,
            hint.providerReferenceFingerprint
          )
          .all<{ readonly intent_id: string }>(),
      catch: unavailable
    })
    if (matches.results.length === 1)
      yield* Effect.result(options.publishWakeup(matches.results[0]!.intent_id))
    return {
      _tag: 'untrusted_hint' as const,
      correlation:
        matches.results.length === 1
          ? ('matched' as const)
          : matches.results.length === 0
            ? ('unknown' as const)
            : ('ambiguous' as const)
    }
  })
