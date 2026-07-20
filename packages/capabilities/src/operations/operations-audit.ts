import { Context, Effect, Layer, Schema } from 'effect'
import { and, desc, eq, lt, or } from 'drizzle-orm'
import type { PromiseDrizzleDatabase } from '@b2b-saas-starter/db'
import { operationsAuditEvents } from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import {
  OperationsAuthorization,
  OperationsContractDenied,
  hasOperatorPermission,
  makeOperationsAuthorizationLayer,
  type OperatorSessionReference
} from './operations-contracts.ts'

export { OperationsContractDenied } from './operations-contracts.ts'

export const OperationsAuditRetentionPolicy = Schema.Literals([
  'operations-standard',
  'impersonation-two-years'
])
export type OperationsAuditRetentionPolicy = typeof OperationsAuditRetentionPolicy.Type

export const OperationsAuditIdentity = Schema.Struct({
  id: Schema.String,
  displayName: Schema.String
})
export type OperationsAuditIdentity = typeof OperationsAuditIdentity.Type

export const RecordOperationsAuditEvent = Schema.Struct({
  businessEventId: Schema.String,
  actor: OperationsAuditIdentity,
  operatorSessionId: Schema.NullOr(Schema.String),
  impersonationId: Schema.NullOr(Schema.String),
  target: Schema.NullOr(OperationsAuditIdentity),
  merchant: Schema.NullOr(OperationsAuditIdentity),
  action: Schema.String,
  result: Schema.Literals(['accepted', 'rejected']),
  occurredAt: Schema.String,
  internalReason: Schema.NullOr(Schema.String),
  supportReference: Schema.NullOr(Schema.String)
})
export type RecordOperationsAuditEvent = typeof RecordOperationsAuditEvent.Type

export const OperationsAuditFilters = Schema.Struct({
  action: Schema.optional(Schema.String),
  result: Schema.optional(Schema.Literals(['accepted', 'rejected'])),
  actorOperatorId: Schema.optional(Schema.String),
  merchantId: Schema.optional(Schema.String),
  targetId: Schema.optional(Schema.String),
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Number)
})
export type OperationsAuditFilters = typeof OperationsAuditFilters.Type

export type OperationsAuditEventSummary = Omit<
  RecordOperationsAuditEvent,
  'businessEventId' | 'internalReason' | 'supportReference'
> & {
  readonly id: string
  readonly retentionPolicy: OperationsAuditRetentionPolicy
  readonly retainUntil: string | null
}

export type OperationsAuditEventDetail = OperationsAuditEventSummary & {
  readonly internalReason: string | null
  readonly supportReference: string | null
}

export type OperationsAuditPage = {
  readonly events: readonly OperationsAuditEventSummary[]
  readonly nextCursor: string | null
}

export class GlobalOperationsAudit extends Context.Service<
  GlobalOperationsAudit,
  {
    readonly record: (
      input: RecordOperationsAuditEvent
    ) => Effect.Effect<void, CapabilityUnavailable>
    readonly list: (
      actor: OperatorSessionReference,
      filters: OperationsAuditFilters
    ) => Effect.Effect<
      OperationsAuditPage,
      OperationsContractDenied | CapabilityUnavailable
    >
    readonly get: (
      actor: OperatorSessionReference,
      eventId: string
    ) => Effect.Effect<
      OperationsAuditEventDetail,
      OperationsContractDenied | CapabilityUnavailable
    >
  }
>()('@b2b-saas-starter/capabilities/GlobalOperationsAudit') {}

const twoYearsAfter = (occurredAt: string): string => {
  const retained = new Date(occurredAt)
  retained.setUTCFullYear(retained.getUTCFullYear() + 2)
  return retained.toISOString()
}

const retentionFor = (input: {
  readonly action: string
  readonly impersonationId: string | null
  readonly occurredAt: string
}) => {
  const retained =
    input.impersonationId !== null ||
    input.action.startsWith('impersonation.') ||
    input.action.startsWith('operations.impersonation.')
  return {
    retentionPolicy: retained
      ? ('impersonation-two-years' as const)
      : ('operations-standard' as const),
    retainUntil: retained ? twoYearsAfter(input.occurredAt) : null
  }
}

const parseCursor = (cursor: string | undefined) => {
  if (!cursor) return null
  const separator = cursor.lastIndexOf('~')
  if (separator < 1 || separator === cursor.length - 1) return null
  return {
    occurredAt: cursor.slice(0, separator),
    id: cursor.slice(separator + 1)
  }
}

const LiveOperationsAudit = (
  db: PromiseDrizzleDatabase
): Layer.Layer<GlobalOperationsAudit, never, OperationsAuthorization> =>
  Layer.effect(GlobalOperationsAudit)(
    Effect.gen(function* () {
      const authorization = yield* OperationsAuthorization
      const requireAuditor = (actor: OperatorSessionReference) =>
        authorization.authorize(actor).pipe(
          Effect.flatMap((principal) =>
            hasOperatorPermission(principal.roles, 'impersonation-audit:read')
              ? Effect.succeed(principal)
              : Effect.fail(
                  new OperationsContractDenied({
                    reason: 'impersonation audit permission is required'
                  })
                )
          )
        )
      const unavailable = () =>
        new CapabilityUnavailable({
          capability: 'global-operations-audit',
          reason: 'operations audit is unavailable'
        })
      const summaryFor = (
        row: typeof operationsAuditEvents.$inferSelect
      ): OperationsAuditEventSummary => ({
        id: row.id,
        actor: {
          id: row.actorOperatorId,
          displayName: row.actorDisplayName
        },
        operatorSessionId: row.operatorSessionId,
        impersonationId: row.impersonationId,
        target: row.targetId
          ? { id: row.targetId, displayName: row.targetDisplayName ?? row.targetId }
          : null,
        merchant: row.merchantId
          ? {
              id: row.merchantId,
              displayName: row.merchantDisplayName ?? row.merchantId
            }
          : null,
        action: row.action,
        result: row.result,
        occurredAt: row.occurredAt,
        retentionPolicy: row.retentionPolicy,
        retainUntil: row.retainUntil
      })

      return {
        record: (input) =>
          Effect.gen(function* () {
            const decoded = yield* Schema.decodeUnknownEffect(
              RecordOperationsAuditEvent
            )(input).pipe(Effect.mapError(unavailable))
            const retention = retentionFor(decoded)
            yield* Effect.tryPromise({
              try: () =>
                db
                  .insert(operationsAuditEvents)
                  .values({
                    id: `oaud_${crypto.randomUUID()}`,
                    businessEventId: decoded.businessEventId,
                    actorOperatorId: decoded.actor.id,
                    actorDisplayName: decoded.actor.displayName,
                    operatorSessionId: decoded.operatorSessionId,
                    impersonationId: decoded.impersonationId,
                    targetId: decoded.target?.id ?? null,
                    targetDisplayName: decoded.target?.displayName ?? null,
                    merchantId: decoded.merchant?.id ?? null,
                    merchantDisplayName: decoded.merchant?.displayName ?? null,
                    action: decoded.action,
                    result: decoded.result,
                    occurredAt: decoded.occurredAt,
                    ...retention,
                    internalReason: decoded.internalReason,
                    supportReference: decoded.supportReference,
                    createdAt: new Date().toISOString()
                  })
                  .onConflictDoNothing({
                    target: operationsAuditEvents.businessEventId
                  }),
              catch: unavailable
            })
          }).pipe(Effect.asVoid),
        list: (actor, filters) =>
          Effect.gen(function* () {
            yield* requireAuditor(actor)
            const decodedFilters = yield* Schema.decodeUnknownEffect(
              OperationsAuditFilters
            )(filters).pipe(
              Effect.mapError(
                () =>
                  new OperationsContractDenied({
                    reason: 'operations audit filters are invalid'
                  })
              )
            )
            const cursor = parseCursor(decodedFilters.cursor)
            const predicates = [
              decodedFilters.action
                ? eq(operationsAuditEvents.action, decodedFilters.action)
                : undefined,
              decodedFilters.result
                ? eq(operationsAuditEvents.result, decodedFilters.result)
                : undefined,
              decodedFilters.actorOperatorId
                ? eq(
                    operationsAuditEvents.actorOperatorId,
                    decodedFilters.actorOperatorId
                  )
                : undefined,
              decodedFilters.merchantId
                ? eq(operationsAuditEvents.merchantId, decodedFilters.merchantId)
                : undefined,
              decodedFilters.targetId
                ? eq(operationsAuditEvents.targetId, decodedFilters.targetId)
                : undefined,
              cursor
                ? or(
                    lt(operationsAuditEvents.occurredAt, cursor.occurredAt),
                    and(
                      eq(operationsAuditEvents.occurredAt, cursor.occurredAt),
                      lt(operationsAuditEvents.id, cursor.id)
                    )
                  )
                : undefined
            ].filter((predicate) => predicate !== undefined)
            const limit = Math.min(Math.max(decodedFilters.limit ?? 50, 1), 100)
            const rows = yield* Effect.tryPromise({
              try: () =>
                db
                  .select()
                  .from(operationsAuditEvents)
                  .where(predicates.length > 0 ? and(...predicates) : undefined)
                  .orderBy(
                    desc(operationsAuditEvents.occurredAt),
                    desc(operationsAuditEvents.id)
                  )
                  .limit(limit + 1),
              catch: unavailable
            })
            const pageRows = rows.slice(0, limit)
            const last = pageRows.at(-1)
            return {
              events: pageRows.map(summaryFor),
              nextCursor:
                rows.length > limit && last ? `${last.occurredAt}~${last.id}` : null
            }
          }),
        get: (actor, eventId) =>
          Effect.gen(function* () {
            yield* requireAuditor(actor)
            const rows = yield* Effect.tryPromise({
              try: () =>
                db
                  .select()
                  .from(operationsAuditEvents)
                  .where(eq(operationsAuditEvents.id, eventId))
                  .limit(1),
              catch: unavailable
            })
            const row = rows[0]
            if (!row) {
              return yield* new OperationsContractDenied({
                reason: 'operations audit event was not found'
              })
            }
            return {
              ...summaryFor(row),
              internalReason: row.internalReason,
              supportReference: row.supportReference
            }
          })
      }
    })
  )

export const makeOperationsAuditLayer = (
  db: PromiseDrizzleDatabase
): Layer.Layer<GlobalOperationsAudit> =>
  LiveOperationsAudit(db).pipe(Layer.provide(makeOperationsAuthorizationLayer(db)))
