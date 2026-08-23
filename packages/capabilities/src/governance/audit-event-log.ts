import { auditEvents, user, type JsonObject } from '@b2b-saas-starter/db/src/schema.ts'
import { Database, type BatchStatement } from '@b2b-saas-starter/db/src/service.ts'
import { Context, DateTime, Effect, Encoding, Layer, Result, Schema } from 'effect'
import { and, desc, eq, gte, lt, lte, or, type SQL } from 'drizzle-orm'

import { type CapabilityUnavailable } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { type AuditEventType, type AuditTargetType } from './audit-event-taxonomy.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { WorkspaceContext } from '../workspace-context.ts'

export const AuditEvent = Schema.Struct({
  id: Schema.String,
  eventType: Schema.String,
  targetType: Schema.String,
  targetId: Schema.NullOr(Schema.String),
  actor: Schema.String,
  createdAt: Schema.String
})
export type AuditEvent = typeof AuditEvent.Type

/** Optional server-side filters for the per-workspace read. */
export type ListAuditEventsInput = {
  /** Only events whose `actorUserId` matches. */
  readonly actorUserId?: string
  /** Only events of this event type (exact match). */
  readonly eventType?: string
  /** ISO timestamp lower bound, inclusive. */
  readonly since?: string
  /** ISO timestamp upper bound, inclusive. */
  readonly until?: string
  /**
   * Opaque keyset cursor from a previous page's `nextCursor`. An
   * undecodable cursor addresses no position and yields an empty page.
   */
  readonly cursor?: string
}

export type AuditEventPage = {
  readonly events: readonly AuditEvent[]
  /** Cursor for the next older page, or null when this page is the last. */
  readonly nextCursor: string | null
}

/**
 * The per-workspace page size and pagination contract: exactly 100 events,
 * keyed on `(createdAt DESC, id DESC)`. The cap stays fixed — widening it is
 * a contract change (see the leaf node), not a parameter callers may pass.
 */
export const AUDIT_EVENT_PAGE_SIZE = 100

function encodeCursor(event: Pick<AuditEvent, 'createdAt' | 'id'>): string {
  return Encoding.encodeBase64(`${event.createdAt} ${event.id}`)
}

function decodeCursor(
  cursor: string
): { readonly createdAt: string; readonly id: string } | null {
  const decoded = Encoding.decodeBase64String(cursor)
  if (Result.isFailure(decoded)) return null
  const [createdAt, id] = decoded.success.split(' ')
  if (!createdAt || !id) return null
  return { createdAt, id }
}

/**
 * Rows the Seed layer filters over. Enriches the wire shape with the storage
 * columns the wire deliberately hides (`workspaceId`, `actorUserId`), so Seed
 * can answer the same server-side filters as Live without reaching into D1.
 */
export type SeedAuditEventRow = AuditEvent & {
  readonly workspaceId?: string | null
  readonly actorUserId?: string | null
}

export type RecordAuditEventInput = {
  readonly workspaceId?: string | null
  readonly actorUserId?: string | null
  /**
   * From the taxonomy module — the write boundary is where the vocabulary is
   * enforced. The read path stays a lenient `Schema.String`.
   */
  readonly eventType: AuditEventType
  readonly targetType: AuditTargetType
  readonly targetId?: string | null
  /**
   * Per-event-type detail (token name + scopes, webhook url + events, delivery
   * attempts). Heterogeneous by design, but JSON — it is stored verbatim in the
   * `audit_events.metadata` JSON column.
   */
  readonly metadata?: JsonObject
}

export type AuditEventLogInterface = {
  readonly list: (
    input?: ListAuditEventsInput
  ) => Effect.Effect<AuditEventPage, CapabilityUnavailable, WorkspaceContext>
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

type AuditRow = {
  event: typeof auditEvents.$inferSelect
  actor: { name: string } | null
}

function toWireRow(row: AuditRow): AuditEvent {
  return {
    id: row.event.id,
    eventType: row.event.eventType,
    targetType: row.event.targetType,
    targetId: row.event.targetId ?? null,
    actor: row.actor?.name ?? 'system',
    createdAt: row.event.createdAt
  }
}

function toWire(rows: readonly SeedAuditEventRow[]): readonly AuditEvent[] {
  return rows.map((row) => ({
    id: row.id,
    eventType: row.eventType,
    targetType: row.targetType,
    targetId: row.targetId ?? null,
    actor: row.actor,
    createdAt: row.createdAt
  }))
}

/**
 * The Seed adapter answers the same filters and keyset pagination as the D1
 * one, in memory over its fixture rows.
 */
function pagedSeedRows(
  rows: readonly SeedAuditEventRow[],
  workspaceId: string | undefined,
  input: ListAuditEventsInput | undefined
): AuditEventPage {
  let cursor: { readonly createdAt: string; readonly id: string } | null | undefined
  if (input?.cursor === undefined) {
    cursor = undefined
  } else {
    cursor = decodeCursor(input.cursor)
  }
  if (cursor === null) {
    return { events: [], nextCursor: null }
  }
  let matched = rows.filter(
    (row) =>
      (workspaceId === undefined || (row.workspaceId ?? null) === workspaceId) &&
      (input?.actorUserId === undefined ||
        (row.actorUserId ?? null) === input.actorUserId) &&
      (input?.eventType === undefined || row.eventType === input.eventType) &&
      (input?.since === undefined || row.createdAt >= input.since) &&
      (input?.until === undefined || row.createdAt <= input.until)
  )
  if (cursor !== undefined) {
    matched = matched.filter(
      (row) =>
        row.createdAt < cursor.createdAt ||
        (row.createdAt === cursor.createdAt && row.id < cursor.id)
    )
  }
  const ordered = matched.toSorted((a, b) => {
    if (a.createdAt > b.createdAt) return -1
    if (a.createdAt < b.createdAt) return 1
    // Same instant: id DESC breaks the tie.
    if (a.id > b.id) return -1
    if (a.id < b.id) return 1
    return 0
  })
  const events = toWire(ordered.slice(0, AUDIT_EVENT_PAGE_SIZE))
  const last = events[events.length - 1]
  let nextCursor: string | null = null
  if (last !== undefined && ordered.length > AUDIT_EVENT_PAGE_SIZE) {
    nextCursor = encodeCursor(last)
  }
  return { events, nextCursor }
}

export function SeedAuditEventLog(
  seed: readonly SeedAuditEventRow[]
): Layer.Layer<AuditEventLog> {
  return Layer.succeed(AuditEventLog)({
    // Same scoping as Live: the per-workspace read filters on the resolved
    // workspace from `WorkspaceContext` (invariant 1) — never an unscoped pass
    // over the fixture. Like the other Seed adapters, the context arrives
    // from the runner (selectWorkspaceLayer / testWorkspaceContext), not from
    // this layer.
    list: (input) =>
      Effect.gen(function* () {
        const ctx = yield* WorkspaceContext
        return pagedSeedRows(seed, ctx.workspace.id, input)
      }),
    listGlobal: Effect.succeed(toWire(seed)),
    record: () => Effect.void,
    prepareRecord: () => Effect.succeed(noopStatement)
  })
}

export const LiveAuditEventLog: Layer.Layer<AuditEventLog, never, Database> =
  Layer.effect(AuditEventLog)(
    Effect.gen(function* () {
      const db = yield* Database

      function pageQuery(workspaceId: string, input?: ListAuditEventsInput) {
        const conditions: SQL[] = [eq(auditEvents.workspaceId, workspaceId)]
        if (input?.actorUserId !== undefined) {
          conditions.push(eq(auditEvents.actorUserId, input.actorUserId))
        }
        if (input?.eventType !== undefined) {
          conditions.push(eq(auditEvents.eventType, input.eventType))
        }
        if (input?.since !== undefined) {
          conditions.push(gte(auditEvents.createdAt, input.since))
        }
        if (input?.until !== undefined) {
          conditions.push(lte(auditEvents.createdAt, input.until))
        }
        // Keyset pagination on `(createdAt DESC, id DESC)`: everything strictly
        // before the cursor's position in that ordering. ISO timestamps compare
        // lexicographically, so plain string comparison is correct here.
        if (input?.cursor !== undefined) {
          const cursor = decodeCursor(input.cursor)
          if (cursor === null) return null
          const older = or(
            lt(auditEvents.createdAt, cursor.createdAt),
            and(
              eq(auditEvents.createdAt, cursor.createdAt),
              lt(auditEvents.id, cursor.id)
            )
          )
          if (older !== undefined) conditions.push(older)
        }
        const query = db
          .select({ event: auditEvents, actor: user })
          .from(auditEvents)
          .leftJoin(user, eq(user.id, auditEvents.actorUserId))
          .where(and(...conditions))
        return query
          .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
          .limit(AUDIT_EVENT_PAGE_SIZE)
      }

      function toPage(rows: readonly AuditRow[]): AuditEventPage {
        const events = rows.map(toWireRow)
        // Only offer an older page when the cap actually cut rows off.
        const last = events[events.length - 1]
        let nextCursor: string | null = null
        if (last !== undefined && events.length === AUDIT_EVENT_PAGE_SIZE) {
          nextCursor = encodeCursor(last)
        }
        return { events, nextCursor }
      }

      function pagedRows(workspaceId: string, input: ListAuditEventsInput | undefined) {
        const query = pageQuery(workspaceId, input)
        // An undecodable cursor addresses no position — empty page.
        if (query === null) return Effect.succeed<AuditRow[]>([])
        return orUnavailable('audit-event-log')(query)
      }

      function queryRows(workspaceId?: string) {
        const base = db
          .select({ event: auditEvents, actor: user })
          .from(auditEvents)
          .leftJoin(user, eq(user.id, auditEvents.actorUserId))
        if (workspaceId === undefined) {
          return orUnavailable('audit-event-log')(
            base.orderBy(desc(auditEvents.createdAt)).limit(100)
          ).pipe(Effect.map((rows) => rows.map(toWireRow)))
        }
        return orUnavailable('audit-event-log')(
          base
            .where(eq(auditEvents.workspaceId, workspaceId))
            .orderBy(desc(auditEvents.createdAt))
            .limit(100)
        ).pipe(Effect.map((rows) => rows.map(toWireRow)))
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
        list: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const rows = yield* pagedRows(ctx.workspace.id, input)
            return toPage(rows)
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
