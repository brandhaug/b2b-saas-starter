import { m } from '@b2b-saas-starter/i18n/messages'
import {
  AuditView,
  AuditViewField,
  AuditViewFilter,
  AuditViewSort,
  defaultAuditView
} from '@b2b-saas-starter/capabilities/governance/audit-event-view'
import { Option, Schema } from 'effect'
import {
  type WorkspaceAuditFilterInput,
  type WorkspaceAuditPayload
} from '@/lib/server/workspace-audit'
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

/** Every audit view field, labelled; the schema owns which fields exist. */
const auditFields = {
  eventType: () => ({ id: 'eventType', label: m.event_label(), kind: 'text' }),
  actorUserId: () => ({ id: 'actorUserId', label: m.actor_label(), kind: 'text' }),
  actorType: () => ({ id: 'actorType', label: m.actor_type_label(), kind: 'text' }),
  createdAt: () => ({ id: 'createdAt', label: m.when_label(), kind: 'date' })
} satisfies { [K in AuditViewField]: () => TableViewField & { readonly id: K } }

export function auditViewFields(): ReadonlyArray<TableViewField> {
  return AuditViewField.literals.map((id) => auditFields[id]())
}

const decodeFilter = Schema.decodeUnknownOption(AuditViewFilter)
const decodeSort = Schema.decodeUnknownOption(AuditViewSort)
const decodeView = Schema.decodeUnknownOption(AuditView)

/** The URL's table view, narrowed to what the audit view schema accepts. */
export function auditViewFromSearch(serialized: string | undefined): AuditView {
  const parsed = parseTableView(serialized, auditViewFields())
  const filters = parsed.filters.flatMap((filter) =>
    Option.toArray(decodeFilter(filter))
  )
  const sorts = parsed.sorts.flatMap((sort) => Option.toArray(decodeSort(sort)))
  return Option.getOrElse(
    decodeView({
      match: parsed.match,
      filters,
      sorts: sorts.length > 0 ? sorts : defaultAuditView.sorts
    }),
    () => defaultAuditView
  )
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
}): WorkspaceAuditFilterInput {
  const filters: WorkspaceAuditFilterInput = {}
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
