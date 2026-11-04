import { sql } from 'drizzle-orm'
import { index, integer, text, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core'

// Shared column helpers. Two timestamp dialects coexist by design: Better Auth
// tables store epoch-seconds in integer columns (its plugin contract), starter
// tables store ISO strings in text columns — see AGENTS.md before normalizing.
// Drizzle column builders are single-use, so every helper returns fresh
// builders per call.
export function id() {
  return text('id').primaryKey()
}

/** One Better Auth epoch-seconds timestamp column, defaulted server-side. */
export function authTimestamp(column: string) {
  return integer(column, { mode: 'timestamp' })
    .default(sql`(unixepoch())`)
    .notNull()
}

export function authCreatedAt() {
  return authTimestamp('createdAt')
}

export function authTimestamps() {
  return {
    createdAt: authCreatedAt(),
    updatedAt: authTimestamp('updatedAt')
  }
}

/**
 * The starter dialect's required creation timestamp: an ISO string in `text`.
 * Nullable ISO timestamps are plain `text(...)` — there is nothing to wrap.
 */
export function isoCreatedAt() {
  return text('created_at').notNull()
}

export function workspaceIdIndex(tableName: string, workspaceId: AnySQLiteColumn) {
  return index(`${tableName}_workspace_id_idx`).on(workspaceId)
}
