import { auditEvents, user } from '@b2b-saas-starter/db/schema'
import { Database } from '@b2b-saas-starter/db/service'
import { DateTime, Effect, Layer } from 'effect'
import { and, desc, eq, gte, lte, type SQL } from 'drizzle-orm'

import {
  auditEventPosition,
  AuditEventLog,
  type AuditEvent,
  type AuditEventPage,
  AUDIT_EVENT_PAGE_SIZE,
  type ListAuditEventsInput,
  type RecordAuditEventInput
} from './audit-event-log.ts'
import { clampPageLimit, cutKeysetPage } from '../internal/keyset-cursor.ts'
import { keysetResume } from '../internal/keyset-query.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { WorkspaceContext } from '../workspace-context.ts'

function pageLimit(input: ListAuditEventsInput | undefined): number {
  if (input?.limit === undefined) {
    return AUDIT_EVENT_PAGE_SIZE
  }
  return clampPageLimit(input.limit)
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

/**
 * Cuts one page off `rows` (already filtered and newest-first) and maps it to
 * the wire shape. `nextCursor` is emitted only when the cap actually cut rows
 * off — never for an exact multiple, whose next page would be empty.
 */
function buildPage<T>(
  rows: ReadonlyArray<T>,
  mapToWire: (row: T) => AuditEvent,
  limit: number
): AuditEventPage {
  const page = cutKeysetPage(rows.map(mapToWire), limit, auditEventPosition)
  return { events: page.items, nextCursor: page.nextCursor }
}

export const LiveAuditEventLog: Layer.Layer<AuditEventLog, never, Database> =
  Layer.effect(AuditEventLog)(
    Effect.gen(function* () {
      const db = yield* Database

      function pageQuery(workspaceId: string, input?: ListAuditEventsInput) {
        const conditions: Array<SQL> = [eq(auditEvents.workspaceId, workspaceId)]
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
        // The SQL half of the keyset recipe lives in `keyset-query.ts`,
        // shared with every other paged Live read: everything strictly
        // before the cursor's position in `(createdAt DESC, id DESC)`.
        const resume = keysetResume(
          'desc',
          { key: auditEvents.createdAt, id: auditEvents.id },
          input?.cursor
        )
        if (resume.kind === 'empty') {
          return null
        }
        if (resume.kind === 'resume') {
          conditions.push(resume.condition)
        }
        const query = db
          .select({ event: auditEvents, actor: user })
          .from(auditEvents)
          .leftJoin(user, eq(user.id, auditEvents.actorUserId))
          .where(and(...conditions))
        // One row past the page cap: `buildPage` needs to see whether the cap
        // actually cut rows off before it offers a cursor.
        return query
          .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
          .limit(pageLimit(input) + 1)
      }

      function pagedRows(workspaceId: string, input: ListAuditEventsInput | undefined) {
        const query = pageQuery(workspaceId, input)
        // An undecodable cursor addresses no position — empty page.
        if (query === null) {
          return Effect.succeed<Array<AuditRow>>([])
        }
        return orUnavailable('audit-event-log')(query)
      }

      /** Every workspace's events, newest first — `/admin`'s cross-workspace read. */
      const globalRows = orUnavailable('audit-event-log')(
        db
          .select({ event: auditEvents, actor: user })
          .from(auditEvents)
          .leftJoin(user, eq(user.id, auditEvents.actorUserId))
          .orderBy(desc(auditEvents.createdAt))
          .limit(100)
      ).pipe(Effect.map((rows) => rows.map(toWireRow)))

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
            return buildPage(rows, toWireRow, pageLimit(input))
          }),
        listGlobal: globalRows,
        record: (input) =>
          insertFor(input).pipe(
            Effect.flatMap(orUnavailable('audit-event-log')),
            Effect.asVoid
          ),
        prepareRecord: (input) => insertFor(input)
      }
    })
  )
