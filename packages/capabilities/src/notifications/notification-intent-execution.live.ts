import { Effect, Layer, Redacted, Schema } from 'effect'
import { Database } from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import { ControlledTemplateFacts } from './controlled-template-eligibility.ts'
import {
  NotificationIntentExecutionStore,
  type NotificationIntentExecutionContext
} from './notification-intent-execution.ts'
import {
  makeDeterministicProviderHarness,
  type DeterministicProviderHarness
} from './provider-contract-testing.ts'
import { ProviderSubmission, type ProviderRuntime } from './provider-contracts.ts'

const unavailable = (reason: unknown) =>
  new CapabilityUnavailable({
    capability: 'notification-intent-execution',
    reason: reason instanceof Error ? reason.message : String(reason)
  })

const tryDb = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({ try: operation, catch: unavailable })

type ExecutionRow = {
  id: string
  payload_json: string
  facts_json: string
  timezone: string
}

export const LiveNotificationIntentExecutionStore: Layer.Layer<
  NotificationIntentExecutionStore,
  never,
  Database
> = Layer.effect(
  NotificationIntentExecutionStore,
  Effect.gen(function* () {
    const db = yield* Database
    const raw = db.$client.config.db
    return {
      load: (intentId) =>
        Effect.gen(function* () {
          const row = yield* tryDb(() =>
            raw
              .prepare(
                `SELECT ni.id, ni.payload_json, nicf.facts_json, s.timezone
                 FROM notification_intents ni
                 JOIN notification_intent_controlled_facts nicf
                   ON nicf.intent_id = ni.id AND nicf.erased_at IS NULL
                 JOIN shops s ON s.id = ni.shop_id
                 WHERE ni.id = ? LIMIT 1`
              )
              .bind(intentId)
              .first<ExecutionRow>()
          )
          if (!row) return yield* Effect.fail(unavailable('intent unavailable'))
          return yield* Effect.try({
            try: () => {
              const payload = JSON.parse(row.payload_json) as {
                readonly permission?: NotificationIntentExecutionContext['permission']
                readonly appointmentStartsAt?: string
              }
              if (!payload.permission || !payload.appointmentStartsAt)
                throw new Error('execution context unavailable')
              return {
                intentId: row.id,
                appointmentStartsAt: payload.appointmentStartsAt,
                shopTimeZone: row.timezone,
                permission: payload.permission,
                facts: Schema.decodeUnknownSync(ControlledTemplateFacts)(
                  JSON.parse(row.facts_json)
                )
              }
            },
            catch: unavailable
          })
        }),
      discoverDue: ({ now, limit, perShopLimit }) =>
        Effect.map(
          tryDb(() =>
            raw
              .prepare(
                `SELECT ni.id, ni.shop_id
                 FROM notification_intents ni
                 LEFT JOIN notification_intent_leases nil
                   ON nil.intent_id = ni.id AND nil.leased_until > ?
                 WHERE ni.available_at <= ?
                   AND ni.phase IN ('scheduled', 'ready', 'routing')
                   AND ni.status IN ('pending', 'processing')
                   AND ni.superseded_at IS NULL
                   AND nil.intent_id IS NULL
                 ORDER BY ni.available_at, ni.created_at, ni.id
                 LIMIT ?`
              )
              .bind(now, now, Math.min(limit * perShopLimit, 1_000))
              .all<{ id: string; shop_id: string }>()
          ),
          ({ results }) => {
            const perShop = new Map<string, number>()
            const selected: string[] = []
            for (const row of results) {
              const count = perShop.get(row.shop_id) ?? 0
              if (count >= perShopLimit) continue
              perShop.set(row.shop_id, count + 1)
              selected.push(row.id)
              if (selected.length >= limit) break
            }
            return selected
          }
        )
    }
  })
)

const fromBase64 = (value: string) => {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

const deriveEncryptionKey = (secret: string) =>
  Effect.promise(() =>
    crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`booking-operational-messaging:encryption:${secret}`)
    )
  )

export const makeProtectedDestinationReveal =
  (input: { readonly encryptionSecret: string; readonly keyVersion: number }) =>
  (ciphertext: string, keyVersion: number) =>
    Effect.tryPromise({
      try: async () => {
        if (keyVersion !== input.keyVersion)
          throw new Error('destination key version unavailable')
        const material = await deriveEncryptionKey(input.encryptionSecret).pipe(
          Effect.runPromise
        )
        const key = await crypto.subtle.importKey('raw', material, 'AES-GCM', false, [
          'decrypt'
        ])
        const envelope = fromBase64(ciphertext)
        if (envelope.length <= 12) throw new Error('invalid destination envelope')
        const plaintext = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: envelope.slice(0, 12) },
          key,
          envelope.slice(12)
        )
        return Redacted.make(new TextDecoder().decode(plaintext))
      },
      catch: unavailable
    })

export const makeDeterministicProviderSubmissionLayer = (
  runtime: ProviderRuntime,
  now = new Date().toISOString()
): {
  readonly layer: Layer.Layer<ProviderSubmission>
  readonly meta: DeterministicProviderHarness
  readonly smso: DeterministicProviderHarness
} => {
  const meta = makeDeterministicProviderHarness({ runtime, provider: 'meta', now })
  const smso = makeDeterministicProviderHarness({ runtime, provider: 'smso', now })
  return {
    meta,
    smso,
    layer: Layer.succeed(ProviderSubmission)({
      submit: (request) =>
        request.provider === 'meta' ? meta.submit(request) : smso.submit(request)
    })
  }
}
