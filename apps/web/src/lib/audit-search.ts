import { type WorkspaceAuditPayload } from '@/lib/server/workspace-audit'

/**
 * The audit page's URL vocabulary: the keys the route's search schema accepts.
 * Filters live in the URL, every change re-runs the loader server-side.
 */
export type WorkspaceAuditSearchUpdate = {
  readonly actor?: string
  readonly eventType?: string
  readonly since?: string
  readonly until?: string
  readonly cursor?: string
}

export type ApplyWorkspaceAuditSearch = (search: WorkspaceAuditSearchUpdate) => void

/**
 * Drops empty and undefined values so cleared controls disappear from the URL
 * entirely. Typed on the search-update shape itself — a key that is not part
 * of the URL vocabulary fails to compile here instead of being stripped by the
 * route's search schema at runtime.
 */
export function compact(
  search: WorkspaceAuditSearchUpdate
): WorkspaceAuditSearchUpdate {
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
    'cursor'
  ]
  for (const key of keys) {
    const value = search[key]
    if (value !== undefined && value !== '') {
      next[key] = value
    }
  }
  return next
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
  const search: {
    -readonly [K in keyof WorkspaceAuditSearchUpdate]: WorkspaceAuditSearchUpdate[K]
  } = {}
  if (filters.actorUserId !== undefined) {
    search.actor = filters.actorUserId
  }
  if (filters.eventType !== undefined) {
    search.eventType = filters.eventType
  }
  if (filters.since !== undefined) {
    search.since = filters.since
  }
  if (filters.until !== undefined) {
    search.until = filters.until
  }
  return compact(search)
}
