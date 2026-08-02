import { Context, Effect, Layer, Schema } from 'effect'
import { Database } from '@b2b-saas-starter/db'
import {
  CapabilityConflict,
  CapabilityDenied,
  CapabilityNotFound,
  CapabilityUnavailable
} from '../errors.ts'

export const capabilityOperations = [
  'read',
  'mutation',
  'search',
  'bulk-operation',
  'export',
  'callback',
  'queued-action'
] as const
export type CapabilityOperation = (typeof capabilityOperations)[number]
export type CapabilityActor =
  | { readonly kind: 'owner'; readonly userId: string; readonly merchantId: string }
  | {
      readonly kind: 'impersonation'
      readonly operatorId: string
      readonly targetUserId: string
      readonly merchantId: string
      readonly impersonationId: string
    }
  | { readonly kind: 'system'; readonly workerId: string; readonly merchantId: string }
  | {
      readonly kind: 'callback'
      readonly correlationId: string
      readonly merchantId: string
    }

export type AccessState = 'active' | 'held' | 'restricted'
export type PolicyRequest = {
  readonly actor: CapabilityActor | null
  readonly merchantId: string
  readonly resourceMerchantId?: string | undefined
  readonly operation: CapabilityOperation
  readonly restrictedException?: 'billing-recovery' | 'existing-commitment' | undefined
}

export const authorizeCapability = (input: PolicyRequest) => {
  if (!input.actor) return new CapabilityDenied({ reason: 'session_required' })
  if (input.actor.merchantId !== input.merchantId)
    return new CapabilityNotFound({ resource: 'merchant-resource' })
  if (input.resourceMerchantId && input.resourceMerchantId !== input.merchantId)
    return new CapabilityNotFound({ resource: 'merchant-resource' })
  if (input.operation === 'callback' && input.actor.kind !== 'callback')
    return new CapabilityDenied({ reason: 'callback_correlation_required' })
  if (input.operation === 'queued-action' && input.actor.kind !== 'system')
    return new CapabilityDenied({ reason: 'worker_authority_required' })
  if (
    (input.actor.kind === 'system' || input.actor.kind === 'callback') &&
    input.operation !== 'queued-action' &&
    input.operation !== 'callback'
  )
    return new CapabilityDenied({ reason: 'owner_session_required' })
  return null
}

export const accessAllows = (state: AccessState, input: PolicyRequest): boolean => {
  if (state === 'held') return false
  if (state !== 'restricted') return true
  return (
    input.operation === 'read' ||
    input.operation === 'search' ||
    input.operation === 'export' ||
    input.restrictedException === 'billing-recovery' ||
    input.restrictedException === 'existing-commitment'
  )
}

export type SharedCommandInput = PolicyRequest & {
  readonly accessState: AccessState
  readonly capability: string
  readonly aggregateId: string
  readonly idempotencyKey: string
  readonly payloadFingerprint: string
  readonly expectedRevision: number
  readonly resultJson: string
  readonly historyKind: string
  readonly outboxKind?: string | undefined
  readonly now: string
}
export type SharedCommandResult = {
  readonly aggregateId: string
  readonly revision: number
  readonly replayed: boolean
  readonly resultJson: string
}
export type OutboxClaim = {
  readonly id: string
  readonly kind: string
  readonly aggregateId: string
  readonly revision: number
}
type FoundationError =
  | CapabilityDenied
  | CapabilityNotFound
  | CapabilityConflict
  | CapabilityUnavailable

export class SharedCapabilityFoundations extends Context.Service<
  SharedCapabilityFoundations,
  {
    readonly execute: (
      input: SharedCommandInput
    ) => Effect.Effect<SharedCommandResult, FoundationError>
    readonly claim: (input: {
      readonly workerId: string
      readonly now: string
      readonly staleBefore: string
      readonly limit: number
    }) => Effect.Effect<readonly OutboxClaim[], CapabilityUnavailable>
    readonly complete: (input: {
      readonly id: string
      readonly workerId: string
      readonly now: string
    }) => Effect.Effect<void, CapabilityUnavailable>
  }
>()('@b2b-saas-starter/capabilities/SharedCapabilityFoundations') {}

const actorAudit = (actor: CapabilityActor) =>
  actor.kind === 'owner'
    ? { actorKind: 'owner', actorId: actor.userId, impersonationId: null }
    : actor.kind === 'impersonation'
      ? {
          actorKind: 'operator',
          actorId: actor.operatorId,
          impersonationId: actor.impersonationId
        }
      : actor.kind === 'system'
        ? { actorKind: 'system', actorId: actor.workerId, impersonationId: null }
        : { actorKind: 'callback', actorId: actor.correlationId, impersonationId: null }

const validate = (input: SharedCommandInput) => {
  const denied = authorizeCapability(input)
  if (denied) return denied
  if (!accessAllows(input.accessState, input))
    return new CapabilityDenied({
      reason:
        input.accessState === 'held' ? 'merchant_access_held' : 'restricted_access'
    })
  return null
}

type Stored = { fingerprint: string; result: SharedCommandResult }
export const SeedSharedCapabilityFoundations =
  (): Layer.Layer<SharedCapabilityFoundations> => {
    const revisions = new Map<string, number>()
    const commands = new Map<string, Stored>()
    const outbox = new Map<
      string,
      OutboxClaim & {
        status: 'pending' | 'claimed' | 'processed'
        claimedBy?: string
        claimedAt?: string
      }
    >()
    return Layer.succeed(SharedCapabilityFoundations)({
      execute: (input) =>
        Effect.try({
          try: () => {
            const denial = validate(input)
            if (denial) throw denial
            const key = `${input.merchantId}:${input.capability}:${input.idempotencyKey}`
            const existing = commands.get(key)
            if (existing) {
              if (existing.fingerprint !== input.payloadFingerprint)
                throw new CapabilityConflict({ reason: 'idempotency_key_reused' })
              return { ...existing.result, replayed: true }
            }
            const current =
              revisions.get(
                `${input.merchantId}:${input.capability}:${input.aggregateId}`
              ) ?? 0
            if (current !== input.expectedRevision)
              throw new CapabilityConflict({
                reason: 'stale_revision',
                currentRevision: current
              })
            const result = {
              aggregateId: input.aggregateId,
              revision: current + 1,
              replayed: false,
              resultJson: input.resultJson
            }
            revisions.set(
              `${input.merchantId}:${input.capability}:${input.aggregateId}`,
              result.revision
            )
            commands.set(key, { fingerprint: input.payloadFingerprint, result })
            if (input.outboxKind)
              outbox.set(
                `cob_${input.capability}_${input.aggregateId}_${result.revision}`,
                {
                  id: `cob_${input.capability}_${input.aggregateId}_${result.revision}`,
                  kind: input.outboxKind,
                  aggregateId: input.aggregateId,
                  revision: result.revision,
                  status: 'pending'
                }
              )
            return result
          },
          catch: (error) => error as FoundationError
        }),
      claim: ({ workerId, now, staleBefore, limit }) =>
        Effect.sync(() =>
          [...outbox.values()]
            .filter(
              (item) =>
                item.status === 'pending' ||
                (item.status === 'claimed' && item.claimedAt! <= staleBefore)
            )
            .slice(0, Math.max(0, limit))
            .map((item) => {
              item.status = 'claimed'
              item.claimedBy = workerId
              item.claimedAt = now
              return {
                id: item.id,
                kind: item.kind,
                aggregateId: item.aggregateId,
                revision: item.revision
              }
            })
        ),
      complete: ({ id, workerId }) =>
        Effect.sync(() => {
          const item = outbox.get(id)
          if (item?.status === 'claimed' && item.claimedBy === workerId)
            item.status = 'processed'
        })
    })
  }

export const LiveSharedCapabilityFoundations: Layer.Layer<
  SharedCapabilityFoundations,
  never,
  Database
> = Layer.effect(
  SharedCapabilityFoundations,
  Effect.gen(function* () {
    const db = yield* Database
    const raw = db.$client.config.db
    return {
      execute: (input) =>
        Effect.tryPromise({
          try: async () => {
            const subscription = await raw
              .prepare(
                'SELECT status FROM merchant_subscriptions WHERE merchant_id = ? LIMIT 1'
              )
              .bind(input.merchantId)
              .first<{ status: string }>()
            const effectiveInput: SharedCommandInput = {
              ...input,
              accessState:
                input.accessState === 'held'
                  ? 'held'
                  : subscription?.status === 'restricted' ||
                      subscription?.status === 'cancelled'
                    ? 'restricted'
                    : input.accessState
            }
            const denial = validate(effectiveInput)
            if (denial) throw denial
            const key = `${input.merchantId}:${input.capability}:${input.idempotencyKey}`
            const old = await raw
              .prepare(
                'SELECT payload_fingerprint, result_json, aggregate_id, revision FROM capability_commands WHERE command_key = ?'
              )
              .bind(key)
              .first<{
                payload_fingerprint: string
                result_json: string
                aggregate_id: string
                revision: number
              }>()
            if (old) {
              if (old.payload_fingerprint !== input.payloadFingerprint)
                throw new CapabilityConflict({ reason: 'idempotency_key_reused' })
              return {
                aggregateId: old.aggregate_id,
                revision: old.revision,
                replayed: true,
                resultJson: old.result_json
              }
            }
            const actor = actorAudit(input.actor!)
            const outboxId = `cob_${input.capability}_${input.aggregateId}_${input.expectedRevision + 1}`
            const statements = [
              raw
                .prepare(
                  `INSERT INTO capability_aggregate_revisions (merchant_id, capability, aggregate_id, revision, updated_at) SELECT ?, ?, ?, 1, ? WHERE ? = 0 ON CONFLICT(merchant_id, capability, aggregate_id) DO UPDATE SET revision = revision + 1, updated_at = excluded.updated_at WHERE revision = ?`
                )
                .bind(
                  input.merchantId,
                  input.capability,
                  input.aggregateId,
                  input.now,
                  input.expectedRevision,
                  input.expectedRevision
                ),
              raw
                .prepare(
                  `INSERT INTO capability_commands (command_key, merchant_id, capability, aggregate_id, payload_fingerprint, result_json, revision, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE (SELECT revision FROM capability_aggregate_revisions WHERE merchant_id = ? AND capability = ? AND aggregate_id = ?) = ?`
                )
                .bind(
                  key,
                  input.merchantId,
                  input.capability,
                  input.aggregateId,
                  input.payloadFingerprint,
                  input.resultJson,
                  input.expectedRevision + 1,
                  input.now,
                  input.merchantId,
                  input.capability,
                  input.aggregateId,
                  input.expectedRevision + 1
                ),
              raw
                .prepare(
                  `INSERT INTO capability_history (id, merchant_id, aggregate_id, revision, kind, occurred_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM capability_commands WHERE command_key = ?)`
                )
                .bind(
                  `chh_${key}`,
                  input.merchantId,
                  input.aggregateId,
                  input.expectedRevision + 1,
                  input.historyKind,
                  input.now,
                  key
                ),
              raw
                .prepare(
                  `INSERT INTO capability_audit (id, merchant_id, aggregate_id, revision, actor_kind, actor_id, impersonation_id, event_kind, occurred_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM capability_commands WHERE command_key = ?)`
                )
                .bind(
                  `cau_${key}`,
                  input.merchantId,
                  input.aggregateId,
                  input.expectedRevision + 1,
                  actor.actorKind,
                  actor.actorId,
                  actor.impersonationId,
                  input.historyKind,
                  input.now,
                  key
                )
            ]
            if (input.outboxKind)
              statements.push(
                raw
                  .prepare(
                    `INSERT INTO capability_outbox (id, merchant_id, aggregate_id, revision, kind, status, available_at, created_at) SELECT ?, ?, ?, ?, ?, 'pending', ?, ? WHERE EXISTS (SELECT 1 FROM capability_commands WHERE command_key = ?)`
                  )
                  .bind(
                    outboxId,
                    input.merchantId,
                    input.aggregateId,
                    input.expectedRevision + 1,
                    input.outboxKind,
                    input.now,
                    input.now,
                    key
                  )
              )
            await raw.batch(statements)
            const created = await raw
              .prepare(
                'SELECT result_json, revision FROM capability_commands WHERE command_key = ?'
              )
              .bind(key)
              .first<{ result_json: string; revision: number }>()
            if (!created) {
              const current = await raw
                .prepare(
                  'SELECT revision FROM capability_aggregate_revisions WHERE merchant_id = ? AND capability = ? AND aggregate_id = ?'
                )
                .bind(input.merchantId, input.capability, input.aggregateId)
                .first<{ revision: number }>()
              throw new CapabilityConflict({
                reason: 'stale_revision',
                currentRevision: current?.revision ?? 0
              })
            }
            return {
              aggregateId: input.aggregateId,
              revision: created.revision,
              replayed: false,
              resultJson: created.result_json
            }
          },
          catch: (cause) =>
            cause instanceof CapabilityDenied ||
            cause instanceof CapabilityNotFound ||
            cause instanceof CapabilityConflict
              ? cause
              : new CapabilityUnavailable({
                  capability: 'shared-capability-foundations',
                  reason: cause instanceof Error ? cause.message : String(cause)
                })
        }),
      claim: (input) =>
        Effect.tryPromise({
          try: async () => {
            const candidates = await raw
              .prepare(
                `SELECT id FROM capability_outbox WHERE status = 'pending' OR (status = 'claimed' AND claimed_at <= ?) ORDER BY available_at, id LIMIT ?`
              )
              .bind(input.staleBefore, Math.max(0, input.limit))
              .all<{ id: string }>()
            const claimed: OutboxClaim[] = []
            for (const row of candidates.results) {
              const result = await raw
                .prepare(
                  `UPDATE capability_outbox SET status = 'claimed', claimed_by = ?, claimed_at = ? WHERE id = ? AND (status = 'pending' OR (status = 'claimed' AND claimed_at <= ?)) RETURNING id, kind, aggregate_id aggregateId, revision`
                )
                .bind(input.workerId, input.now, row.id, input.staleBefore)
                .first<OutboxClaim>()
              if (result) claimed.push(result)
            }
            return claimed
          },
          catch: (cause) =>
            new CapabilityUnavailable({
              capability: 'shared-capability-outbox',
              reason: String(cause)
            })
        }),
      complete: (input) =>
        Effect.tryPromise({
          try: async () => {
            await raw
              .prepare(
                `UPDATE capability_outbox SET status = 'processed', processed_at = ? WHERE id = ? AND status = 'claimed' AND claimed_by = ?`
              )
              .bind(input.now, input.id, input.workerId)
              .run()
          },
          catch: (cause) =>
            new CapabilityUnavailable({
              capability: 'shared-capability-outbox',
              reason: String(cause)
            })
        })
    }
  })
)

export const AuthorizationMatrixRow = Schema.Struct({
  operation: Schema.String,
  owner: Schema.Boolean,
  held: Schema.Boolean,
  restricted: Schema.Boolean,
  impersonation: Schema.Boolean
})
export const authorizationMatrix = capabilityOperations.map((operation) => ({
  operation,
  owner: true,
  held: false,
  restricted: operation === 'read' || operation === 'search' || operation === 'export',
  impersonation: operation !== 'callback' && operation !== 'queued-action'
}))
