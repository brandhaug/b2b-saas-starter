import { m } from '@b2b-saas-starter/i18n/messages'
import { type AuditView } from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import { type WorkspaceAuditPayload } from '@/lib/server/workspace-audit'
import { parseTableView, type TableViewField } from '@/lib/table-view'

/**
 * The audit page's URL vocabulary: the keys the route's search schema accepts.
 * Filters live in the URL, every change re-runs the loader server-side.
 */
export type WorkspaceAuditSearchUpdate = {
  readonly actor?: string
  readonly eventType?: string
  readonly since?: string
  readonly until?: string
  readonly event?: string
  readonly cursor?: string
  readonly view?: string
}

export type ApplyWorkspaceAuditSearch = (search: WorkspaceAuditSearchUpdate) => void

/**
 * Drops empty and undefined values so cleared controls disappear from the URL
 * entirely. Typed on the search-update shape itself — a key that is not part
 * of the URL vocabulary fails to compile here instead of being stripped by the
 * route's search schema at runtime.
 */
export function compact(search: {
  readonly [K in keyof WorkspaceAuditSearchUpdate]?: string | undefined
}): WorkspaceAuditSearchUpdate {
  // Mutable build type — the search update's properties are readonly on the
  // wire shape, but the compaction assembles the kept values into a new one.
  const next: {
    -readonly [K in keyof WorkspaceAuditSearchUpdate]: WorkspaceAuditSearchUpdate[K]
  } = {}
  const keys: ReadonlyArray<keyof WorkspaceAuditSearchUpdate> = [
    'actor',
    'eventType',
    'since',
    'until',
    'cursor',
    'event',
    'view'
  ]
  for (const key of keys) {
    const value = search[key]
    if (value !== undefined && value !== '') {
      next[key] = value
    }
  }
  return next
}

export function auditViewFields(): ReadonlyArray<TableViewField> {
  return [
    { id: 'eventType', label: m.event_label(), kind: 'text' },
    { id: 'actorUserId', label: m.actor_label(), kind: 'text' },
    { id: 'actorType', label: m.actor_type_label(), kind: 'text' },
    { id: 'createdAt', label: m.when_label(), kind: 'date' }
  ]
}

export function auditViewFromSearch(serialized: string | undefined): AuditView {
  const parsed = parseTableView(serialized, auditViewFields())
  const filters: Array<AuditView['filters'][number]> = []
  for (const filter of parsed.filters.slice(0, 12)) {
    const { field, operator, value } = filter
    if (field === 'createdAt') {
      if (
        operator !== 'contains' &&
        operator !== 'notContains' &&
        value.length <= 128
      ) {
        filters.push({ field, operator, value })
      }
    } else if (
      field === 'eventType' ||
      field === 'actorUserId' ||
      field === 'actorType'
    ) {
      filters.push({ field, operator, value })
    }
  }
  const sorts: Array<AuditView['sorts'][number]> = []
  for (const sort of parsed.sorts.slice(0, 4)) {
    const { field, direction } = sort
    if (
      field === 'eventType' ||
      field === 'actorUserId' ||
      field === 'actorType' ||
      field === 'createdAt'
    ) {
      sorts.push({ field, direction })
    }
  }
  if (sorts.length === 0) {
    sorts.push({ field: 'createdAt', direction: 'desc' })
  }
  return { match: parsed.match, filters, sorts }
}

/**
 * The payload echoes the capability's filter contract, which keys the actor
 * `actorUserId`; the URL vocabulary keys the same value `actor` (the route's
 * search schema, and what `filtersFromSearch` maps back). Translating once —
 * instead of spreading the payload's filters into an update — is what keeps a
 * chosen actor through any second filter change or page turn.
 */
export function auditSearchFromFilters(
  filters: WorkspaceAuditPayload['filters']
): WorkspaceAuditSearchUpdate {
  return compact({
    actor: filters.actorUserId,
    eventType: filters.eventType,
    since: filters.since,
    until: filters.until
  })
}

/**
 * The URL vocabulary mapped back onto the capability's filter contract — the
 * inverse of `auditSearchFromFilters`, and the one place `actor` becomes
 * `actorUserId`. Shared by the audit route's loader and the `/demo` renderer,
 * which filters the same shape against fixtures.
 */
export function auditFiltersFromSearch(search: {
  readonly actor?: string | undefined
  readonly eventType?: string | undefined
  readonly since?: string | undefined
  readonly until?: string | undefined
}): WorkspaceAuditPayload['filters'] {
  const filters: WorkspaceAuditPayload['filters'] = {}
  if (search.actor !== undefined) {
    filters.actorUserId = search.actor
  }
  if (search.eventType !== undefined) {
    filters.eventType = search.eventType
  }
  if (search.since !== undefined) {
    filters.since = search.since
  }
  if (search.until !== undefined) {
    filters.until = search.until
  }
  return filters
}
