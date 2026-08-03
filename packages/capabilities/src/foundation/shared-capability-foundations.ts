import { Context, Effect, Layer, Schema } from 'effect'
import type { D1Database } from '@cloudflare/workers-types'
import { Database, rawD1FromDatabase } from '@b2b-saas-starter/db'
import {
  CapabilityConflict,
  CapabilityDenied,
  CapabilityNotFound,
  CapabilityUnavailable
} from '../errors.ts'

const NonEmptyString = Schema.String.check(Schema.isMinLength(1))
const IsoDateTime = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/)
)
const Revision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const CapabilityOperation = Schema.Literals([
  'read',
  'mutation',
  'search',
  'bulk-operation',
  'export',
  'callback',
  'queued-action'
])
export type CapabilityOperation = typeof CapabilityOperation.Type
export const capabilityOperations = [...CapabilityOperation.literals]

export const CapabilityAuthorityReference = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('owner-session'), sessionId: NonEmptyString }),
  Schema.Struct({
    kind: Schema.Literal('impersonated-session'),
    merchantSessionId: NonEmptyString
  }),
  Schema.Struct({
    kind: Schema.Literal('callback-correlation'),
    correlationId: NonEmptyString
  }),
  Schema.Struct({
    kind: Schema.Literal('claimed-work'),
    workerId: NonEmptyString,
    outboxId: NonEmptyString
  })
])
export type CapabilityAuthorityReference = typeof CapabilityAuthorityReference.Type

export const SharedCommand = Schema.Struct({
  authority: CapabilityAuthorityReference,
  merchantId: NonEmptyString,
  operation: CapabilityOperation,
  capability: NonEmptyString,
  aggregateId: NonEmptyString,
  idempotencyKey: NonEmptyString,
  payloadFingerprint: NonEmptyString,
  expectedRevision: Revision,
  resultJson: NonEmptyString,
  historyKind: NonEmptyString,
  outboxKind: Schema.optional(NonEmptyString),
  availableAt: Schema.optional(IsoDateTime),
  now: IsoDateTime
})
export type SharedCommandInput = typeof SharedCommand.Type

export const DomainMutationRequest = Schema.Struct({
  kind: NonEmptyString,
  payloadJson: Schema.String
})
export type DomainMutationRequest = typeof DomainMutationRequest.Type

export const SharedCommandResult = Schema.Struct({
  aggregateId: NonEmptyString,
  revision: Revision,
  replayed: Schema.Boolean,
  resultJson: NonEmptyString
})
export type SharedCommandResult = typeof SharedCommandResult.Type

export const OutboxClaim = Schema.Struct({
  id: NonEmptyString,
  kind: NonEmptyString,
  aggregateId: NonEmptyString,
  revision: Revision
})
export type OutboxClaim = typeof OutboxClaim.Type

export const QueueWakeup = Schema.Struct({
  version: Schema.Literal(1),
  kind: Schema.Literal('capability-outbox'),
  outboxId: NonEmptyString
})
export type QueueWakeup = typeof QueueWakeup.Type

const SqlIdentifier = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9_]*$/),
  Schema.isMaxLength(64)
)
const SqlValue = Schema.Union([
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Null
])
const MerchantScopedMutation = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal('insert'),
    table: SqlIdentifier,
    id: NonEmptyString,
    values: Schema.Record(SqlIdentifier, SqlValue)
  }),
  Schema.Struct({
    operation: Schema.Literal('update'),
    table: SqlIdentifier,
    id: NonEmptyString,
    values: Schema.Record(SqlIdentifier, SqlValue)
  }),
  Schema.Struct({
    operation: Schema.Literal('delete'),
    table: SqlIdentifier,
    id: NonEmptyString
  })
])
type MerchantScopedMutation = typeof MerchantScopedMutation.Type
const DomainMutationPlan = Schema.Struct({
  merchantId: NonEmptyString,
  mutations: Schema.Array(MerchantScopedMutation)
})
type DomainMutationPlan = typeof DomainMutationPlan.Type

export const OutboxClaimRequest = Schema.Struct({
  workerId: NonEmptyString,
  now: IsoDateTime,
  staleBefore: IsoDateTime,
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 }))
})
export type OutboxClaimRequest = typeof OutboxClaimRequest.Type
export const OutboxCompletionRequest = Schema.Struct({
  id: NonEmptyString,
  workerId: NonEmptyString,
  now: IsoDateTime
})
export type OutboxCompletionRequest = typeof OutboxCompletionRequest.Type
export const OutboxProcessRequest = Schema.Struct({
  outboxId: NonEmptyString,
  workerId: NonEmptyString,
  now: IsoDateTime,
  staleBefore: IsoDateTime
})
export type OutboxProcessRequest = typeof OutboxProcessRequest.Type

type FoundationError =
  | CapabilityDenied
  | CapabilityNotFound
  | CapabilityConflict
  | CapabilityUnavailable

export type SharedCapabilityFoundationsShape = {
  readonly execute: (
    input: SharedCommandInput,
    domainInput?: DomainMutationRequest
  ) => Effect.Effect<SharedCommandResult, FoundationError>
  readonly claim: (
    input: OutboxClaimRequest
  ) => Effect.Effect<readonly OutboxClaim[], CapabilityUnavailable>
  readonly complete: (
    input: OutboxCompletionRequest
  ) => Effect.Effect<void, CapabilityUnavailable>
  readonly process: (
    input: OutboxProcessRequest
  ) => Effect.Effect<void, CapabilityUnavailable>
}

export class SharedCapabilityFoundations extends Context.Service<
  SharedCapabilityFoundations,
  SharedCapabilityFoundationsShape
>()('@b2b-saas-starter/capabilities/SharedCapabilityFoundations') {}

type ResolvedAuthority = {
  readonly merchantId: string
  readonly actorKind: 'owner' | 'operator' | 'system' | 'callback'
  readonly actorId: string
  readonly impersonationId: string | null
  readonly accessState: 'active' | 'held' | 'restricted'
}

const commandKey = (input: SharedCommandInput) =>
  JSON.stringify([input.merchantId, input.capability, input.idempotencyKey])
const aggregateKey = (input: SharedCommandInput) =>
  JSON.stringify([input.merchantId, input.capability, input.aggregateId])
const resourceKey = (input: SharedCommandInput) =>
  JSON.stringify([input.capability, input.aggregateId])
const nextRevision = (input: SharedCommandInput) => input.expectedRevision + 1
const outboxId = (input: SharedCommandInput, revision: number) =>
  `cob:${JSON.stringify([
    input.merchantId,
    input.capability,
    input.aggregateId,
    revision
  ])}`
const replayFingerprint = (
  input: SharedCommandInput,
  domainInput: DomainMutationRequest | undefined
) => {
  const canonical = JSON.stringify([
    1,
    input.merchantId,
    input.capability,
    input.aggregateId,
    input.operation,
    input.payloadFingerprint,
    input.expectedRevision,
    input.resultJson,
    input.historyKind,
    input.outboxKind ?? null,
    input.availableAt ?? null,
    domainInput?.kind ?? null,
    domainInput?.payloadJson ?? null
  ])
  return crypto.subtle
    .digest('SHA-256', new TextEncoder().encode(canonical))
    .then(
      (digest) =>
        `sha256:${[...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join('')}`
    )
}

const validateDomainScope = (
  mutation: DomainMutationPlan,
  authority: ResolvedAuthority
) => {
  if (mutation.merchantId !== authority.merchantId)
    return new CapabilityNotFound({ resource: 'merchant-resource' })
  if (
    mutation.mutations.some(
      (item) =>
        'values' in item && ('id' in item.values || 'merchant_id' in item.values)
    )
  )
    return new CapabilityDenied({ reason: 'reserved_domain_column' })
  return null
}

const prepareDomainMutation =
  (raw: D1Database, merchantId: string) => (mutation: MerchantScopedMutation) => {
    const table = `"${mutation.table}"`
    if (mutation.operation === 'delete')
      return raw
        .prepare(`DELETE FROM ${table} WHERE merchant_id = ? AND id = ?`)
        .bind(merchantId, mutation.id)
    const entries = Object.entries(mutation.values).sort(([left], [right]) =>
      left.localeCompare(right)
    )
    if (mutation.operation === 'insert') {
      const columns = ['id', 'merchant_id', ...entries.map(([column]) => column)]
      return raw
        .prepare(
          `INSERT INTO ${table} (${columns.map((column) => `"${column}"`).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
        )
        .bind(mutation.id, merchantId, ...entries.map(([, value]) => value))
    }
    if (entries.length === 0)
      throw new CapabilityDenied({ reason: 'empty_domain_update' })
    return raw
      .prepare(
        `UPDATE ${table} SET ${entries.map(([column]) => `"${column}" = ?`).join(', ')} WHERE merchant_id = ? AND id = ?`
      )
      .bind(...entries.map(([, value]) => value), merchantId, mutation.id)
  }

const authorizeResolved = (
  input: SharedCommandInput,
  authority: ResolvedAuthority,
  resourceMerchantId: string | undefined,
  restrictedMutationAllowed: boolean
) => {
  if (authority.merchantId !== input.merchantId)
    return new CapabilityNotFound({ resource: 'merchant-resource' })
  if (resourceMerchantId && resourceMerchantId !== authority.merchantId)
    return new CapabilityNotFound({ resource: 'merchant-resource' })
  if (input.operation === 'callback' && authority.actorKind !== 'callback')
    return new CapabilityDenied({ reason: 'callback_correlation_required' })
  if (input.operation === 'queued-action' && authority.actorKind !== 'system')
    return new CapabilityDenied({ reason: 'worker_authority_required' })
  if (
    (authority.actorKind === 'system' || authority.actorKind === 'callback') &&
    input.operation !== 'queued-action' &&
    input.operation !== 'callback'
  )
    return new CapabilityDenied({ reason: 'owner_session_required' })
  if (authority.accessState === 'held')
    return new CapabilityDenied({ reason: 'merchant_access_held' })
  if (
    authority.accessState === 'restricted' &&
    input.operation !== 'read' &&
    input.operation !== 'search' &&
    input.operation !== 'export' &&
    !restrictedMutationAllowed
  )
    return new CapabilityDenied({ reason: 'restricted_access' })
  return null
}

type SeedFoundationOptions = {
  readonly authorities?: ReadonlyMap<string, ResolvedAuthority>
  readonly publishWakeup?: (wakeup: QueueWakeup) => void
  readonly buildDomainMutation?: (
    input: SharedCommandInput,
    domainInput: DomainMutationRequest | undefined
  ) => DomainMutationPlan
  readonly classifyRestrictedMutation?: (
    input: SharedCommandInput,
    domainInput: DomainMutationRequest | undefined,
    context: { readonly resourceExists: boolean }
  ) => boolean
  readonly applyDomainMutation?: (mutation: DomainMutationPlan) => void
  readonly handleOutbox?: (claim: OutboxClaim) => void
}

const authorityReferenceKey = (authority: CapabilityAuthorityReference) =>
  JSON.stringify([authority])

export const SeedSharedCapabilityFoundations = (
  options: SeedFoundationOptions = {}
): Layer.Layer<SharedCapabilityFoundations> => {
  const revisions = new Map<string, number>()
  const commands = new Map<
    string,
    { readonly fingerprint: string; readonly result: SharedCommandResult }
  >()
  const resourceOwners = new Map<string, Set<string>>()
  const outbox = new Map<
    string,
    OutboxClaim & {
      readonly availableAt: string
      status: 'pending' | 'claimed' | 'processed'
      claimedBy?: string
      claimedAt?: string
    }
  >()
  const resolve = (input: SharedCommandInput) => {
    const authority = options.authorities?.get(authorityReferenceKey(input.authority))
    if (!authority) throw new CapabilityDenied({ reason: 'authority_not_found' })
    return authority
  }
  return Layer.succeed(SharedCapabilityFoundations)({
    execute: (input, domainInput) =>
      Effect.tryPromise({
        try: async () => {
          const decoded = Schema.decodeUnknownSync(SharedCommand)(input)
          const mutationRequest =
            domainInput === undefined
              ? undefined
              : Schema.decodeUnknownSync(DomainMutationRequest)(domainInput)
          if (domainInput !== undefined && !options.buildDomainMutation)
            throw new CapabilityUnavailable({
              capability: decoded.capability,
              reason: 'domain_mutation_adapter_not_registered'
            })
          const mutation = Schema.decodeUnknownSync(DomainMutationPlan)(
            options.buildDomainMutation?.(decoded, mutationRequest) ?? {
              merchantId: decoded.merchantId,
              mutations: []
            }
          )
          const authority = resolve(decoded)
          const key = commandKey(decoded)
          const fingerprint = await replayFingerprint(decoded, mutationRequest)
          const existing = commands.get(key)
          if (existing && existing.fingerprint !== fingerprint)
            throw new CapabilityConflict({ reason: 'idempotency_key_reused' })
          const scopedResourceKey = resourceKey(decoded)
          const owners = resourceOwners.get(scopedResourceKey)
          const ownsResource = owners?.has(decoded.merchantId) ?? false
          if (decoded.expectedRevision > 0 && !ownsResource)
            throw new CapabilityNotFound({ resource: 'merchant-resource' })
          const denial = authorizeResolved(
            decoded,
            authority,
            ownsResource ? decoded.merchantId : undefined,
            options.classifyRestrictedMutation?.(decoded, mutationRequest, {
              resourceExists: ownsResource
            }) ?? false
          )
          if (denial) throw denial
          const domainDenial = validateDomainScope(mutation, authority)
          if (domainDenial) throw domainDenial
          if (existing) {
            if (decoded.outboxKind)
              options.publishWakeup?.({
                version: 1,
                kind: 'capability-outbox',
                outboxId: outboxId(decoded, existing.result.revision)
              })
            return { ...existing.result, replayed: true }
          }
          const current = revisions.get(aggregateKey(decoded)) ?? 0
          if (current !== decoded.expectedRevision)
            throw new CapabilityConflict({
              reason: 'stale_revision',
              currentRevision: current
            })
          options.applyDomainMutation?.(mutation)
          const revision = nextRevision(decoded)
          const result = {
            aggregateId: decoded.aggregateId,
            revision,
            replayed: false,
            resultJson: decoded.resultJson
          }
          revisions.set(aggregateKey(decoded), revision)
          const committedOwners =
            resourceOwners.get(scopedResourceKey) ?? new Set<string>()
          committedOwners.add(decoded.merchantId)
          resourceOwners.set(scopedResourceKey, committedOwners)
          commands.set(key, { fingerprint, result })
          if (decoded.outboxKind) {
            const id = outboxId(decoded, revision)
            outbox.set(id, {
              id,
              kind: decoded.outboxKind,
              aggregateId: decoded.aggregateId,
              revision,
              availableAt: decoded.availableAt ?? decoded.now,
              status: 'pending'
            })
            options.publishWakeup?.({
              version: 1,
              kind: 'capability-outbox',
              outboxId: id
            })
          }
          return result
        },
        catch: (cause) =>
          cause instanceof CapabilityDenied ||
          cause instanceof CapabilityNotFound ||
          cause instanceof CapabilityConflict ||
          cause instanceof CapabilityUnavailable
            ? cause
            : new CapabilityUnavailable({
                capability: 'shared-capability-foundations',
                reason: cause instanceof Error ? cause.message : String(cause)
              })
      }),
    claim: (input) =>
      Effect.try({
        try: () => {
          const { workerId, now, staleBefore, limit } =
            Schema.decodeUnknownSync(OutboxClaimRequest)(input)
          return [...outbox.values()]
            .filter(
              (item) =>
                item.availableAt <= now &&
                (item.status === 'pending' ||
                  (item.status === 'claimed' && item.claimedAt! <= staleBefore))
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
        },
        catch: (cause) =>
          new CapabilityUnavailable({
            capability: 'shared-capability-outbox',
            reason: cause instanceof Error ? cause.message : String(cause)
          })
      }),
    complete: (input) =>
      Effect.try({
        try: () => {
          const { id, workerId } = Schema.decodeUnknownSync(OutboxCompletionRequest)(
            input
          )
          const item = outbox.get(id)
          if (item?.status === 'claimed' && item.claimedBy === workerId)
            item.status = 'processed'
        },
        catch: (cause) =>
          new CapabilityUnavailable({
            capability: 'shared-capability-outbox',
            reason: cause instanceof Error ? cause.message : String(cause)
          })
      }),
    process: (input) =>
      Effect.try({
        try: () => {
          const decoded = Schema.decodeUnknownSync(OutboxProcessRequest)(input)
          if (!options.handleOutbox) throw new Error('handler_not_registered')
          const item = outbox.get(decoded.outboxId)
          if (item?.status === 'processed') return
          if (
            !item ||
            item.availableAt > decoded.now ||
            (item.status === 'claimed' && item.claimedAt! > decoded.staleBefore)
          )
            throw new Error('outbox_not_due_or_claimable')
          item.status = 'claimed'
          item.claimedBy = decoded.workerId
          item.claimedAt = decoded.now
          options.handleOutbox({
            id: item.id,
            kind: item.kind,
            aggregateId: item.aggregateId,
            revision: item.revision
          })
          item.status = 'processed'
        },
        catch: (cause) =>
          new CapabilityUnavailable({
            capability: 'shared-capability-outbox',
            reason: cause instanceof Error ? cause.message : String(cause)
          })
      })
  })
}

type LiveFoundationOptions = {
  readonly publishWakeup?: (wakeup: QueueWakeup) => Promise<void>
  readonly buildDomainMutation?: (
    input: SharedCommandInput,
    domainInput: DomainMutationRequest | undefined
  ) => DomainMutationPlan | Promise<DomainMutationPlan>
  readonly classifyRestrictedMutation?: (
    input: SharedCommandInput,
    domainInput: DomainMutationRequest | undefined,
    context: { readonly resourceExists: boolean }
  ) => boolean
  readonly handleOutbox?: (claim: OutboxClaim) => Promise<void>
  readonly resolveMerchantAccess: (
    d1: D1Database,
    merchantId: string
  ) => Effect.Effect<'active' | 'restricted' | null, CapabilityUnavailable>
}

type AuthorityRow = {
  readonly merchantId: string
  readonly actorKind: ResolvedAuthority['actorKind']
  readonly actorId: string
  readonly impersonationId: string | null
  readonly merchantStatus: string
  readonly accessHold: number
}

const accessStateFrom = (
  row: AuthorityRow,
  merchantAccess: 'active' | 'restricted'
): ResolvedAuthority['accessState'] => (row.accessHold === 1 ? 'held' : merchantAccess)

export const makeLiveSharedCapabilityFoundations = (
  options: LiveFoundationOptions
): Layer.Layer<SharedCapabilityFoundations, never, Database> =>
  Layer.effect(
    SharedCapabilityFoundations,
    Effect.gen(function* () {
      const db = yield* Database
      const raw = rawD1FromDatabase(db)
      const resolveAuthority = async (
        input: SharedCommandInput
      ): Promise<ResolvedAuthority> => {
        const reference = input.authority
        let row: AuthorityRow | null = null
        if (reference.kind === 'owner-session')
          row = await raw
            .prepare(
              `SELECT mm.merchant_id merchantId, 'owner' actorKind, s.userId actorId,
                      NULL impersonationId, m.status merchantStatus,
                      EXISTS (SELECT 1 FROM merchant_access_holds h
                        WHERE h.merchant_id = m.id AND h.user_id = s.userId
                          AND h.released_at IS NULL) accessHold
               FROM session s
               JOIN user u ON u.id = s.userId
               JOIN merchant_memberships mm ON mm.user_id = s.userId AND mm.role = 'owner'
               JOIN merchants m ON m.id = mm.merchant_id
               WHERE s.id = ?1 AND s.expiresAt > unixepoch(?2) AND u.banned = 0
                 AND u.identityClass = 'merchant_member' AND m.status = 'enabled'
               LIMIT 1`
            )
            .bind(reference.sessionId, input.now)
            .first<AuthorityRow>()
        else if (reference.kind === 'impersonated-session')
          row = await raw
            .prepare(
              `SELECT ir.merchant_id merchantId, 'operator' actorKind,
                      ir.operator_id actorId, ir.id impersonationId,
                      m.status merchantStatus,
                      EXISTS (SELECT 1 FROM merchant_access_holds h
                        WHERE h.merchant_id = m.id AND h.user_id = ir.target_member_id
                          AND h.released_at IS NULL) accessHold
               FROM impersonation_records ir
               JOIN session s ON s.id = ir.merchant_session_id
                 AND s.userId = ir.target_member_id
                 AND s.impersonatedBy = ir.operator_id
               JOIN session operator_session ON operator_session.id = ir.operator_session_id
                 AND operator_session.userId = ir.operator_id
               JOIN user operator ON operator.id = ir.operator_id
               JOIN twoFactor factor ON factor.userId = operator.id
               JOIN user target ON target.id = ir.target_member_id
               JOIN merchants m ON m.id = ir.merchant_id
               JOIN merchant_memberships mm ON mm.merchant_id = m.id
                 AND mm.user_id = ir.target_member_id AND mm.role = 'owner'
               WHERE ir.merchant_session_id = ?1 AND ir.lifecycle = 'active'
                 AND ir.active_expires_at > unixepoch(?2) AND s.expiresAt > unixepoch(?2)
                 AND ir.termination_cause IS NULL
                 AND operator.identityClass = 'system_operator'
                 AND operator.banned = 0 AND operator.emailVerified = 1
                 AND operator.twoFactorEnabled = 1
                 AND operator_session.expiresAt > unixepoch(?2)
                 AND operator_session.operatorIdleExpiresAt > unixepoch(?2)
                 AND operator_session.operatorAbsoluteExpiresAt > unixepoch(?2)
                 AND factor.verified = 1
                 AND (factor.lockedUntil IS NULL OR factor.lockedUntil <= unixepoch(?2))
                 AND instr(',' || operator.role || ',', ',merchant-impersonator,') > 0
                 AND target.identityClass = 'merchant_member' AND target.banned = 0
                 AND m.status = 'enabled'
               LIMIT 1`
            )
            .bind(reference.merchantSessionId, input.now)
            .first<AuthorityRow>()
        else if (reference.kind === 'callback-correlation')
          row = await raw
            .prepare(
              `SELECT c.merchant_id merchantId, 'callback' actorKind,
                      c.correlation_id actorId, NULL impersonationId,
                      m.status merchantStatus,
                      0 accessHold
               FROM capability_callback_correlations c
               JOIN merchants m ON m.id = c.merchant_id
               WHERE c.correlation_id = ?1 AND c.capability = ?2
                 AND unixepoch(c.expires_at) > unixepoch(?3)
                 AND m.status = 'enabled' LIMIT 1`
            )
            .bind(reference.correlationId, input.capability, input.now)
            .first<AuthorityRow>()
        else
          row = await raw
            .prepare(
              `SELECT o.merchant_id merchantId, 'system' actorKind,
                      o.claimed_by actorId, NULL impersonationId,
                      m.status merchantStatus,
                      0 accessHold
               FROM capability_outbox o
               JOIN merchants m ON m.id = o.merchant_id
               WHERE o.id = ? AND o.claimed_by = ? AND o.status = 'claimed'
                 AND o.capability = ? AND m.status = 'enabled' LIMIT 1`
            )
            .bind(reference.outboxId, reference.workerId, input.capability)
            .first<AuthorityRow>()
        if (!row) throw new CapabilityDenied({ reason: 'authority_not_found' })
        const merchantAccess = await Effect.runPromise(
          options.resolveMerchantAccess(raw, row.merchantId)
        )
        if (!merchantAccess)
          throw new CapabilityDenied({ reason: 'authority_not_found' })
        return {
          merchantId: row.merchantId,
          actorKind: row.actorKind,
          actorId: row.actorId,
          impersonationId: row.impersonationId,
          accessState: accessStateFrom(row, merchantAccess)
        }
      }
      const publish = async (id: string) => {
        if (!options.publishWakeup)
          throw new CapabilityUnavailable({
            capability: 'shared-capability-queue',
            reason: 'queue_wakeup_unavailable'
          })
        await options.publishWakeup({
          version: 1,
          kind: 'capability-outbox',
          outboxId: id
        })
      }
      const execute: SharedCapabilityFoundationsShape['execute'] = (
        input,
        domainInput
      ) =>
        Effect.tryPromise({
          try: async () => {
            const decoded = Schema.decodeUnknownSync(SharedCommand)(input)
            const mutationRequest =
              domainInput === undefined
                ? undefined
                : Schema.decodeUnknownSync(DomainMutationRequest)(domainInput)
            if (domainInput !== undefined && !options.buildDomainMutation)
              throw new CapabilityUnavailable({
                capability: decoded.capability,
                reason: 'domain_mutation_adapter_not_registered'
              })
            const mutation = Schema.decodeUnknownSync(DomainMutationPlan)(
              (await options.buildDomainMutation?.(decoded, mutationRequest)) ?? {
                merchantId: decoded.merchantId,
                mutations: []
              }
            )
            const authority = await resolveAuthority(decoded)
            const key = commandKey(decoded)
            const fingerprint = await replayFingerprint(decoded, mutationRequest)
            const old = await raw
              .prepare(
                'SELECT result_json resultJson, aggregate_id aggregateId, revision, payload_fingerprint fingerprint FROM capability_commands WHERE command_key = ?'
              )
              .bind(key)
              .first<{
                resultJson: string
                aggregateId: string
                revision: number
                fingerprint: string
              }>()
            if (old && old.fingerprint !== fingerprint)
              throw new CapabilityConflict({ reason: 'idempotency_key_reused' })
            const ownResource = await raw
              .prepare(
                `SELECT merchant_id merchantId FROM capability_aggregate_revisions
                 WHERE merchant_id = ? AND capability = ? AND aggregate_id = ? LIMIT 1`
              )
              .bind(decoded.merchantId, decoded.capability, decoded.aggregateId)
              .first<{ merchantId: string }>()
            if (decoded.expectedRevision > 0 && !ownResource)
              throw new CapabilityNotFound({ resource: 'merchant-resource' })
            const denial = authorizeResolved(
              decoded,
              authority,
              ownResource?.merchantId,
              options.classifyRestrictedMutation?.(decoded, mutationRequest, {
                resourceExists: ownResource?.merchantId === authority.merchantId
              }) ?? false
            )
            if (denial) throw denial
            const domainDenial = validateDomainScope(mutation, authority)
            if (domainDenial) throw domainDenial
            if (old) {
              if (decoded.outboxKind) await publish(outboxId(decoded, old.revision))
              return {
                aggregateId: old.aggregateId,
                revision: old.revision,
                replayed: true,
                resultJson: old.resultJson
              }
            }
            const current = await raw
              .prepare(
                'SELECT revision FROM capability_aggregate_revisions WHERE merchant_id = ? AND capability = ? AND aggregate_id = ?'
              )
              .bind(decoded.merchantId, decoded.capability, decoded.aggregateId)
              .first<{ revision: number }>()
            if ((current?.revision ?? 0) !== decoded.expectedRevision)
              throw new CapabilityConflict({
                reason: 'stale_revision',
                currentRevision: current?.revision ?? 0
              })
            const revision = nextRevision(decoded)
            const guardId = `guard:${key}`
            const prepared = [
              raw
                .prepare(
                  `INSERT INTO capability_transaction_guards (id, accepted)
                   VALUES (?, CASE WHEN
                     (? = 0 AND NOT EXISTS (SELECT 1 FROM capability_aggregate_revisions WHERE merchant_id = ? AND capability = ? AND aggregate_id = ?))
                     OR EXISTS (SELECT 1 FROM capability_aggregate_revisions WHERE merchant_id = ? AND capability = ? AND aggregate_id = ? AND revision = ?)
                   THEN 1 ELSE 0 END)`
                )
                .bind(
                  guardId,
                  decoded.expectedRevision,
                  decoded.merchantId,
                  decoded.capability,
                  decoded.aggregateId,
                  decoded.merchantId,
                  decoded.capability,
                  decoded.aggregateId,
                  decoded.expectedRevision
                ),
              raw
                .prepare(
                  `INSERT INTO capability_aggregate_revisions (merchant_id, capability, aggregate_id, revision, updated_at)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(merchant_id, capability, aggregate_id)
                   DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at`
                )
                .bind(
                  decoded.merchantId,
                  decoded.capability,
                  decoded.aggregateId,
                  revision,
                  decoded.now
                ),
              ...mutation.mutations.map(prepareDomainMutation(raw, decoded.merchantId)),
              raw
                .prepare(
                  `INSERT INTO capability_commands
                   (command_key, merchant_id, capability, aggregate_id, payload_fingerprint, result_json, revision, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
                )
                .bind(
                  key,
                  decoded.merchantId,
                  decoded.capability,
                  decoded.aggregateId,
                  fingerprint,
                  decoded.resultJson,
                  revision,
                  decoded.now
                ),
              raw
                .prepare(
                  `INSERT INTO capability_history
                   (id, merchant_id, capability, aggregate_id, revision, kind, occurred_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)`
                )
                .bind(
                  `chh_${key}`,
                  decoded.merchantId,
                  decoded.capability,
                  decoded.aggregateId,
                  revision,
                  decoded.historyKind,
                  decoded.now
                ),
              raw
                .prepare(
                  `INSERT INTO capability_audit
                   (id, merchant_id, capability, aggregate_id, revision, actor_kind, actor_id, impersonation_id, event_kind, occurred_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                )
                .bind(
                  `cau_${key}`,
                  decoded.merchantId,
                  decoded.capability,
                  decoded.aggregateId,
                  revision,
                  authority.actorKind,
                  authority.actorId,
                  authority.impersonationId,
                  decoded.historyKind,
                  decoded.now
                )
            ]
            if (decoded.outboxKind)
              prepared.push(
                raw
                  .prepare(
                    `INSERT INTO capability_outbox
                     (id, merchant_id, capability, aggregate_id, revision, kind, status, available_at, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
                  )
                  .bind(
                    outboxId(decoded, revision),
                    decoded.merchantId,
                    decoded.capability,
                    decoded.aggregateId,
                    revision,
                    decoded.outboxKind,
                    decoded.availableAt ?? decoded.now,
                    decoded.now
                  )
              )
            prepared.push(
              raw
                .prepare('DELETE FROM capability_transaction_guards WHERE id = ?')
                .bind(guardId)
            )
            try {
              await raw.batch(prepared)
            } catch (cause) {
              const winner = await raw
                .prepare(
                  'SELECT result_json resultJson, aggregate_id aggregateId, revision, payload_fingerprint fingerprint FROM capability_commands WHERE command_key = ?'
                )
                .bind(key)
                .first<{
                  resultJson: string
                  aggregateId: string
                  revision: number
                  fingerprint: string
                }>()
              if (winner) {
                if (winner.fingerprint !== fingerprint)
                  throw new CapabilityConflict({ reason: 'idempotency_key_reused' })
                if (decoded.outboxKind)
                  await publish(outboxId(decoded, winner.revision))
                return {
                  aggregateId: winner.aggregateId,
                  revision: winner.revision,
                  replayed: true,
                  resultJson: winner.resultJson
                }
              }
              const latest = await raw
                .prepare(
                  'SELECT revision FROM capability_aggregate_revisions WHERE merchant_id = ? AND capability = ? AND aggregate_id = ?'
                )
                .bind(decoded.merchantId, decoded.capability, decoded.aggregateId)
                .first<{ revision: number }>()
              if ((latest?.revision ?? 0) !== decoded.expectedRevision)
                throw new CapabilityConflict({
                  reason: 'stale_revision',
                  currentRevision: latest?.revision ?? 0
                })
              throw cause
            }
            if (decoded.outboxKind) await publish(outboxId(decoded, revision))
            return {
              aggregateId: decoded.aggregateId,
              revision,
              replayed: false,
              resultJson: decoded.resultJson
            }
          },
          catch: (cause) =>
            cause instanceof CapabilityDenied ||
            cause instanceof CapabilityNotFound ||
            cause instanceof CapabilityConflict ||
            cause instanceof CapabilityUnavailable
              ? cause
              : new CapabilityUnavailable({
                  capability: 'shared-capability-foundations',
                  reason: cause instanceof Error ? cause.message : String(cause)
                })
        })
      return {
        execute,
        claim: (input) =>
          Effect.tryPromise({
            try: async () => {
              const decoded = Schema.decodeUnknownSync(OutboxClaimRequest)(input)
              const candidates = await raw
                .prepare(
                  `SELECT id FROM capability_outbox
                   WHERE available_at <= ? AND
                     (status = 'pending' OR (status = 'claimed' AND claimed_at <= ?))
                   ORDER BY available_at, id LIMIT ?`
                )
                .bind(decoded.now, decoded.staleBefore, decoded.limit)
                .all<{ id: string }>()
              const claimed: OutboxClaim[] = []
              for (const row of candidates.results) {
                const result = await raw
                  .prepare(
                    `UPDATE capability_outbox
                     SET status = 'claimed', claimed_by = ?, claimed_at = ?
                     WHERE id = ? AND available_at <= ? AND
                       (status = 'pending' OR (status = 'claimed' AND claimed_at <= ?))
                     RETURNING id, kind, aggregate_id aggregateId, revision`
                  )
                  .bind(
                    decoded.workerId,
                    decoded.now,
                    row.id,
                    decoded.now,
                    decoded.staleBefore
                  )
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
              const decoded = Schema.decodeUnknownSync(OutboxCompletionRequest)(input)
              await raw
                .prepare(
                  `UPDATE capability_outbox SET status = 'processed', processed_at = ?
                   WHERE id = ? AND status = 'claimed' AND claimed_by = ?`
                )
                .bind(decoded.now, decoded.id, decoded.workerId)
                .run()
            },
            catch: (cause) =>
              new CapabilityUnavailable({
                capability: 'shared-capability-outbox',
                reason: String(cause)
              })
          }),
        process: (input) =>
          Effect.tryPromise({
            try: async () => {
              const decoded = Schema.decodeUnknownSync(OutboxProcessRequest)(input)
              if (!options.handleOutbox) throw new Error('handler_not_registered')
              const claim = await raw
                .prepare(
                  `UPDATE capability_outbox
                   SET status = 'claimed', claimed_by = ?, claimed_at = ?
                   WHERE id = ? AND available_at <= ? AND
                     (status = 'pending' OR (status = 'claimed' AND claimed_at <= ?))
                   RETURNING id, kind, aggregate_id aggregateId, revision`
                )
                .bind(
                  decoded.workerId,
                  decoded.now,
                  decoded.outboxId,
                  decoded.now,
                  decoded.staleBefore
                )
                .first<OutboxClaim>()
              if (!claim) {
                const existing = await raw
                  .prepare('SELECT status FROM capability_outbox WHERE id = ?')
                  .bind(decoded.outboxId)
                  .first<{ status: string }>()
                if (existing?.status === 'processed') return
                throw new Error('outbox_not_due_or_claimable')
              }
              await options.handleOutbox(claim)
              await raw
                .prepare(
                  `UPDATE capability_outbox SET status = 'processed', processed_at = ?
                   WHERE id = ? AND status = 'claimed' AND claimed_by = ?`
                )
                .bind(decoded.now, decoded.outboxId, decoded.workerId)
                .run()
            },
            catch: (cause) =>
              new CapabilityUnavailable({
                capability: 'shared-capability-outbox',
                reason: cause instanceof Error ? cause.message : String(cause)
              })
          })
      }
    })
  )

export const AuthorizationMatrixRow = Schema.Struct({
  capability: NonEmptyString,
  operation: CapabilityOperation,
  owner: Schema.Boolean,
  held: Schema.Boolean,
  restricted: Schema.Boolean,
  restrictedExceptions: Schema.Array(NonEmptyString),
  impersonation: Schema.Boolean,
  authority: Schema.Literals([
    'owner-session',
    'impersonated-session',
    'callback-correlation',
    'claimed-work'
  ])
})
export type AuthorizationMatrixRow = typeof AuthorizationMatrixRow.Type

const matrixAuthority = (
  operation: CapabilityOperation
): AuthorizationMatrixRow['authority'] =>
  operation === 'callback'
    ? 'callback-correlation'
    : operation === 'queued-action'
      ? 'claimed-work'
      : 'owner-session'

export type AuthorizationCapabilityInventory = {
  readonly capability: string
  readonly operations: readonly CapabilityOperation[]
  readonly restrictedExceptions?: Readonly<
    Partial<Record<CapabilityOperation, readonly string[]>>
  >
}

export const makeAuthorizationMatrix = (
  inventory: readonly AuthorizationCapabilityInventory[]
): readonly AuthorizationMatrixRow[] =>
  inventory.flatMap((capability) =>
    capability.operations.map((operation) => ({
      capability: capability.capability,
      operation,
      owner: operation !== 'callback' && operation !== 'queued-action',
      held: false,
      restricted:
        operation === 'read' || operation === 'search' || operation === 'export',
      restrictedExceptions: [...(capability.restrictedExceptions?.[operation] ?? [])],
      impersonation: operation !== 'callback' && operation !== 'queued-action',
      authority: matrixAuthority(operation)
    }))
  )

export const renderAuthorizationMatrix = (rows: readonly AuthorizationMatrixRow[]) => {
  const header = [
    'Capability',
    'Operation',
    'Required authority',
    'Owner',
    'Access Hold',
    'Restricted Access',
    'Impersonation',
    'Cross-Merchant'
  ]
  const values = rows.map((row) => [
    row.capability,
    row.operation,
    row.authority,
    row.owner ? 'allow' : 'deny',
    'deny',
    row.restricted
      ? 'allow'
      : row.restrictedExceptions.length > 0
        ? `deny; registered: ${row.restrictedExceptions.join(', ')}`
        : 'deny',
    row.impersonation ? 'allow with provenance' : 'deny',
    'same-shape not found'
  ])
  const widths = header.map((heading, index) =>
    Math.max(heading.length, ...values.map((row) => row[index]!.length), 3)
  )
  const tableRow = (cells: readonly string[]) =>
    `| ${cells.map((cell, index) => cell.padEnd(widths[index]!)).join(' | ')} |`
  return `${[
    '# Authorization and Merchant-isolation matrix',
    '',
    'Generated from the Merchant capability inventory and bounded-context Restricted Access policies.',
    '',
    tableRow(header),
    tableRow(widths.map((width) => '-'.repeat(width))),
    ...values.map(tableRow),
    '',
    'Denied mutations must leave domain, notification, financial, outbox, and success-audit facts unchanged.',
    ''
  ].join('\n')}`
}
