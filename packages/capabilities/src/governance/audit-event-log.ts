import { Context, DateTime, Effect, Layer, Schema } from 'effect'
import { desc, eq } from 'drizzle-orm'
import {
  auditEvents,
  Database,
  user,
  type BatchStatement,
  type JsonObject
} from '@b2b-saas-starter/db'
import type { CapabilityUnavailable } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { WorkspaceContext } from '../workspace-context.ts'

export const AuditEvent = Schema.Struct({
  id: Schema.String,
  eventType: Schema.String,
  targetType: Schema.String,
  actor: Schema.String,
  createdAt: Schema.String
})
export type AuditEvent = typeof AuditEvent.Type

export type RecordAuditEventInput = {
  readonly workspaceId?: string | null
  readonly actorUserId?: string | null
  readonly eventType: string
  readonly targetType: string
  readonly targetId?: string | null
  /**
   * Per-event-type detail (token name + scopes, webhook url + events, delivery
   * attempts). Heterogeneous by design, but JSON — it is stored verbatim in the
   * `audit_events.metadata` JSON column.
   */
  readonly metadata?: JsonObject
}

export type AuditEventLogInterface = {
  readonly list: Effect.Effect<
    readonly AuditEvent[],
    CapabilityUnavailable,
    WorkspaceContext
  >
  readonly listGlobal: Effect.Effect<readonly AuditEvent[], CapabilityUnavailable>
  readonly record: (
    input: RecordAuditEventInput
  ) => Effect.Effect<void, CapabilityUnavailable>
  /**
   * Builds the audit insert statement (id + timestamp owned here) without
   * executing it, so mutating capabilities can run it atomically alongside
   * their own write via `batch` from `@b2b-saas-starter/db`. Effectful because
   * the id and `createdAt` are read from `Clock`, not from the ambient wall
   * clock — yield it, then pass the statement to `batch`.
   */
  readonly prepareRecord: (
    input: RecordAuditEventInput
  ) => Effect.Effect<BatchStatement>
}

export class AuditEventLog extends Context.Service<
  AuditEventLog,
  AuditEventLogInterface
>()('@b2b-saas-starter/capabilities/AuditEventLog') {}

const noopStatement: BatchStatement = {
  toSQL: () => ({ sql: 'select 1', params: [] })
}

export function SeedAuditEventLog(
  seed: readonly AuditEvent[]
): Layer.Layer<AuditEventLog> {
  return Layer.succeed(AuditEventLog)({
    list: Effect.succeed(seed),
    listGlobal: Effect.succeed(seed),
    record: () => Effect.void,
    prepareRecord: () => Effect.succeed(noopStatement)
  })
}

export const LiveAuditEventLog: Layer.Layer<AuditEventLog, never, Database> =
  Layer.effect(AuditEventLog)(
    Effect.gen(function* () {
      const db = yield* Database

      function auditQuery(workspaceId?: string) {
        const base = db
          .select({ event: auditEvents, actor: user })
          .from(auditEvents)
          .leftJoin(user, eq(user.id, auditEvents.actorUserId))
        if (workspaceId === undefined) {
          return base.orderBy(desc(auditEvents.createdAt)).limit(100)
        }
        return base
          .where(eq(auditEvents.workspaceId, workspaceId))
          .orderBy(desc(auditEvents.createdAt))
          .limit(100)
      }

      function queryRows(workspaceId?: string) {
        return orUnavailable('audit-event-log')(auditQuery(workspaceId)).pipe(
          Effect.map((rows) =>
            rows.map((row) => ({
              id: row.event.id,
              eventType: row.event.eventType,
              targetType: row.event.targetType,
              actor: row.actor?.name ?? 'system',
              createdAt: row.event.createdAt
            }))
          )
        )
      }

      const insertFor = Effect.fnUntraced(function* (input: RecordAuditEventInput) {
        const id = yield* newCapabilityId('aud')
        const createdAt = yield* DateTime.now
        return db.insert(auditEvents).values({
          id,
          workspaceId: input.workspaceId ?? null,
          actorUserId: input.actorUserId ?? null,
          eventType: input.eventType,
          targetType: input.targetType,
          targetId: input.targetId ?? null,
          metadata: input.metadata ?? {},
          createdAt: DateTime.formatIso(createdAt)
        })
      })

      return {
        list: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          return yield* queryRows(ctx.workspace.id)
        }),
        listGlobal: queryRows(),
        record: (input) =>
          insertFor(input).pipe(
            Effect.flatMap(orUnavailable('audit-event-log')),
            Effect.asVoid
          ),
        prepareRecord: (input) => insertFor(input)
      }
    })
  )
