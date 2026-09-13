// oxlint-disable effect/noGlobals -- D1 SQL parameters require serialized typed JSON at this adapter boundary.
import { auditEvents, user } from '@b2b-saas-starter/db/schema'
import { auditActorTypes } from '@b2b-saas-starter/db/enums'
import { Database } from '@b2b-saas-starter/db/service'
import { DateTime, Effect, Layer, Schema } from 'effect'
import { and, asc, desc, eq, gte, lte, or, sql, type SQL } from 'drizzle-orm'

import {
  AUDIT_ACTOR_TYPE_INVALID,
  AuditEventLog,
  type AuditEvent,
  AUDIT_EVENT_PAGE_SIZE,
  type ListAuditEventsInput,
  type RecordAuditEventInput,
  type AuditView
} from './audit-event-log.ts'
import {
  type AuditViewFilter,
  type AuditViewSort,
  auditViewKey,
  normalizeAuditView,
  decodeAuditCursor,
  encodeAuditCursor
} from './audit-event-view.ts'
import { clampPageLimit, type Page } from '../internal/keyset-cursor.ts'
import { newCapabilityId } from '../internal/ids.ts'
import {
  CapabilityUnavailable,
  orUnavailable
} from '@b2b-saas-starter/failure/capability'
import { decodeAuditEventMetadata } from './audit-event-metadata.ts'
import { WorkspaceContext } from '../workspace-context.ts'

/** Provenance the taxonomy names; anything else never reaches the insert. */
const decodeAuditActorType = Schema.decodeUnknownEffect(
  Schema.Literals(auditActorTypes)
)

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
    actorType: row.event.actorType,
    createdAt: row.event.createdAt
  }
}

/**
 * Cuts one page off `rows` (already filtered and newest-first) and maps it to
 * the wire shape. `nextCursor` is emitted only when the cap actually cut rows
 * off — never for an exact multiple, whose next page would be empty.
 */
function buildPage(
  rows: ReadonlyArray<AuditRow>,
  limit: number,
  view: AuditView,
  key: string
): Page<AuditEvent> {
  const items = rows.slice(0, limit).map(toWireRow)
  const last = rows[limit - 1]
  let nextCursor: string | null = null
  if (rows.length > limit && last) {
    nextCursor = encodeAuditCursor({
      view: key,
      values: view.sorts.map((sort) => last.event[sort.field] ?? ''),
      id: last.event.id
    })
  }
  return { items, nextCursor }
}

function columnFor(field: AuditViewSort['field']): SQL {
  switch (field) {
    case 'eventType': {
      return sql`${auditEvents.eventType}`
    }
    case 'actorUserId': {
      return sql`coalesce(${auditEvents.actorUserId}, '')`
    }
    case 'actorType': {
      return sql`${auditEvents.actorType}`
    }
    case 'createdAt': {
      return sql`${auditEvents.createdAt}`
    }
  }
  return sql`''`
}

function filterSql(filter: AuditViewFilter): SQL {
  const column = columnFor(filter.field)
  const value = filter.value
  if (
    filter.field === 'createdAt' &&
    (filter.operator === 'is' || filter.operator === 'isNot')
  ) {
    const [start, end] = value.split('|')
    if (start && end) {
      const range = sql`${column} >= ${start} and ${column} <= ${end}`
      if (filter.operator === 'isNot') {
        return sql`not (${range})`
      }
      return range
    }
  }
  switch (filter.operator) {
    case 'contains': {
      return sql`instr(${column}, ${value}) > 0`
    }
    case 'notContains': {
      return sql`instr(${column}, ${value}) = 0`
    }
    case 'is': {
      return sql`${column} = ${value}`
    }
    case 'isNot': {
      return sql`${column} <> ${value}`
    }
    case 'before': {
      return sql`${column} < ${value}`
    }
    case 'after': {
      return sql`${column} > ${value}`
    }
    case 'gt': {
      return sql`${column} > ${value}`
    }
    case 'lt': {
      return sql`${column} < ${value}`
    }
    case 'isEmpty': {
      return sql`(${column} is null or ${column} = '')`
    }
    case 'isNotEmpty': {
      return sql`(${column} is not null and ${column} <> '')`
    }
  }
}

function cursorComparison(
  column: SQL,
  value: string,
  direction: 'asc' | 'desc' | undefined
): SQL {
  if (direction === 'asc') {
    return sql`${column} > ${value}`
  }
  return sql`${column} < ${value}`
}
function sortColumn(column: SQL, direction: 'asc' | 'desc' | undefined): SQL {
  if (direction === 'asc') {
    return asc(column)
  }
  return desc(column)
}

function resumeSql(
  view: AuditView,
  cursor: ReturnType<typeof decodeAuditCursor>
): SQL | null {
  if (cursor === undefined) {
    return null
  }
  if (cursor === null) {
    return sql`false`
  }
  const clauses: Array<SQL> = []
  for (let index = 0; index < view.sorts.length; index += 1) {
    const sort = view.sorts[index]
    const value = cursor.values[index]
    if (!sort || value === undefined) {
      return sql`false`
    }
    const column = columnFor(sort.field)
    const comparison = cursorComparison(column, value, sort.direction)
    const prefix = view.sorts
      .slice(0, index)
      .map(
        (prior, priorIndex) =>
          sql`${columnFor(prior.field)} = ${cursor.values[priorIndex] ?? ''}`
      )
    clauses.push(and(...prefix, comparison) ?? comparison)
    if (index === view.sorts.length - 1) {
      const idComparison = cursorComparison(
        sql`${auditEvents.id}`,
        cursor.id,
        view.sorts.at(-1)?.direction
      )
      clauses.push(
        and(
          ...view.sorts.map(
            (prior, priorIndex) =>
              sql`${columnFor(prior.field)} = ${cursor.values[priorIndex] ?? ''}`
          ),
          idComparison
        ) ?? idComparison
      )
    }
  }
  return or(...clauses) ?? sql`false`
}

export const LiveAuditEventLog: Layer.Layer<AuditEventLog, never, Database> =
  Layer.effect(AuditEventLog)(
    Effect.gen(function* () {
      const db = yield* Database

      function pageQuery(workspaceId: string, input?: ListAuditEventsInput) {
        const view = normalizeAuditView(input?.view)
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
        const predicates = view.filters.map(filterSql)
        if (predicates.length > 0) {
          if (view.match === 'all') {
            conditions.push(and(...predicates) ?? sql`false`)
          } else {
            conditions.push(or(...predicates) ?? sql`false`)
          }
        }
        const resume = resumeSql(
          view,
          decodeAuditCursor(
            input?.cursor,
            auditViewKey(view, workspaceId, input),
            view.sorts.length
          )
        )
        if (resume) {
          conditions.push(resume)
        }
        const query = db
          .select({ event: auditEvents, actor: user })
          .from(auditEvents)
          .leftJoin(user, eq(user.id, auditEvents.actorUserId))
          .where(and(...conditions))
        // One row past the page cap: `buildPage` needs to see whether the cap
        // actually cut rows off before it offers a cursor.
        return query
          .orderBy(
            ...view.sorts.map((sort) =>
              sortColumn(columnFor(sort.field), sort.direction)
            ),
            sortColumn(sql`${auditEvents.id}`, view.sorts.at(-1)?.direction)
          )
          .limit(pageLimit(input) + 1)
      }

      function pagedRows(workspaceId: string, input: ListAuditEventsInput | undefined) {
        const query = pageQuery(workspaceId, input)
        // An undecodable cursor addresses no position — empty page.
        return orUnavailable('audit-event-log')(query)
      }

      /**
       * Every workspace's events, newest first — `/admin`'s cross-workspace
       * read. `id` breaks `createdAt` ties so the order is total and the Seed
       * adapter can reproduce it row for row.
       */
      const globalRows = orUnavailable('audit-event-log')(
        db
          .select({ event: auditEvents, actor: user })
          .from(auditEvents)
          .leftJoin(user, eq(user.id, auditEvents.actorUserId))
          .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
          .limit(AUDIT_EVENT_PAGE_SIZE)
      ).pipe(Effect.map((rows) => rows.map(toWireRow)))

      const insertFor = Effect.fnUntraced(function* (
        input: RecordAuditEventInput,
        condition?: SQL
      ) {
        // The last boundary before provenance becomes evidence. The column
        // has no CHECK constraint, so a caller the type system did not reach
        // would otherwise write an actor type nobody can interpret.
        yield* decodeAuditActorType(input.actorType).pipe(
          Effect.mapError(
            () =>
              new CapabilityUnavailable({
                capability: 'audit-event-log',
                reason: AUDIT_ACTOR_TYPE_INVALID
              })
          )
        )
        const id = yield* newCapabilityId('aud')
        const createdAt = yield* DateTime.now
        return db.insert(auditEvents).select(
          db
            .select({
              id: sql<string>`${id}`.as('id'),
              workspaceId: sql<string | null>`${input.workspaceId ?? null}`.as(
                'workspaceId'
              ),
              actorUserId: sql<string | null>`${input.actorUserId ?? null}`.as(
                'actorUserId'
              ),
              actorType: sql`${input.actorType}`.as('actorType'),
              eventType: sql`${input.eventType}`.as('eventType'),
              targetType: sql`${input.targetType}`.as('targetType'),
              targetId: sql<string | null>`${input.targetId ?? null}`.as('targetId'),
              metadata: sql`${JSON.stringify(input.metadata ?? {})}`.as('metadata'),
              createdAt: sql<string>`${DateTime.formatIso(createdAt)}`.as('createdAt')
            })
            .from(sql`(select 1)`)
            .where(condition)
        )
      })

      return {
        get: Effect.fn('AuditEventLog.get')(function* (id: string) {
          const ctx = yield* WorkspaceContext
          const rows = yield* orUnavailable('audit-event-log')(
            db
              .select({ event: auditEvents, actor: user })
              .from(auditEvents)
              .leftJoin(user, eq(user.id, auditEvents.actorUserId))
              .where(
                and(
                  eq(auditEvents.workspaceId, ctx.workspace.id),
                  eq(auditEvents.id, id)
                )
              )
              .limit(1)
          )
          const row = rows[0]
          if (!row) {
            return null
          }
          return {
            ...toWireRow(row),
            actorUserId: row.event.actorUserId,
            metadata: decodeAuditEventMetadata(row.event.metadata)
          }
        }),
        list: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const rows = yield* pagedRows(ctx.workspace.id, input)
            const view = normalizeAuditView(input?.view)
            return buildPage(
              rows,
              pageLimit(input),
              view,
              auditViewKey(view, ctx.workspace.id, input)
            )
          }),
        listGlobal: globalRows,
        record: (input) =>
          insertFor(input).pipe(
            Effect.flatMap(orUnavailable('audit-event-log')),
            Effect.asVoid
          ),
        prepareRecord: (input, condition) => insertFor(input, condition)
      }
    })
  )
