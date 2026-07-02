import { Context, Effect, Layer, Schema } from 'effect'
import { desc, eq } from 'drizzle-orm'
import { auditEvents, Database, user, type BatchStatement } from '@b2b-saas-starter/db'
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
  readonly metadata?: Record<string, unknown>
}

export type AuditEventLogShape = {
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
   * their own write via `batch` from `@b2b-saas-starter/db`.
   */
  readonly prepareRecord: (input: RecordAuditEventInput) => BatchStatement
}

export class AuditEventLog extends Context.Service<AuditEventLog, AuditEventLogShape>()(
  '@b2b-saas-starter/capabilities/AuditEventLog'
) {}

const noopStatement: BatchStatement = {
  toSQL: () => ({ sql: 'select 1', params: [] })
}

export const SeedAuditEventLog = (
  seed: readonly AuditEvent[]
): Layer.Layer<AuditEventLog> =>
  Layer.succeed(AuditEventLog)({
    list: Effect.succeed(seed),
    listGlobal: Effect.succeed(seed),
    record: () => Effect.void,
    prepareRecord: () => noopStatement
  })

export const LiveAuditEventLog: Layer.Layer<AuditEventLog, never, Database> =
  Layer.effect(AuditEventLog)(
    Effect.gen(function* () {
      const db = yield* Database

      const queryRows = (workspaceId?: string) =>
        orUnavailable('audit-event-log')(
          workspaceId === undefined
            ? db
                .select({ event: auditEvents, actor: user })
                .from(auditEvents)
                .leftJoin(user, eq(user.id, auditEvents.actorUserId))
                .orderBy(desc(auditEvents.createdAt))
                .limit(100)
            : db
                .select({ event: auditEvents, actor: user })
                .from(auditEvents)
                .leftJoin(user, eq(user.id, auditEvents.actorUserId))
                .where(eq(auditEvents.workspaceId, workspaceId))
                .orderBy(desc(auditEvents.createdAt))
                .limit(100)
        ).pipe(
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

      const insertFor = (input: RecordAuditEventInput) =>
        db.insert(auditEvents).values({
          id: newCapabilityId('aud'),
          workspaceId: input.workspaceId ?? null,
          actorUserId: input.actorUserId ?? null,
          eventType: input.eventType,
          targetType: input.targetType,
          targetId: input.targetId ?? null,
          metadata: input.metadata ?? {},
          createdAt: new Date().toISOString()
        })

      return {
        list: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          return yield* queryRows(ctx.workspace.id)
        }),
        listGlobal: queryRows(),
        record: (input) =>
          orUnavailable('audit-event-log')(insertFor(input)).pipe(Effect.asVoid),
        prepareRecord: (input) => insertFor(input)
      }
    })
  )
