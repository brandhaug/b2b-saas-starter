import { sql } from 'drizzle-orm'
import { Schema } from 'effect'
import { jsonText } from '../json-column.ts'
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { workspaceExportStatuses, auditActorTypes } from '../enums.ts'
import { user, session } from './auth.ts'
import { workspaceRef, workspaceRefNullable } from './workspaces.ts'
import { id, isoCreatedAt, workspaceIdIndex } from './columns.ts'

export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: id(),
    workspaceId: workspaceRefNullable(),
    actorUserId: text('actor_user_id').references(() => user.id),
    actorType: text('actor_type', { enum: auditActorTypes }).notNull(),
    eventType: text('event_type').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    metadata: jsonText(
      'audit_events',
      'metadata',
      Schema.Record(Schema.String, Schema.Json)
    )
      .default(sql`'{}'`)
      .notNull(),
    createdAt: isoCreatedAt()
  },
  (table) => [
    // Covers plain workspace_id lookups too (leftmost prefix), so no separate
    // single-column index is needed.
    index('audit_events_workspace_created_at_idx').on(
      table.workspaceId,
      table.createdAt
    ),
    index('audit_events_actor_user_id_idx').on(table.actorUserId),
    index('audit_events_retention_idx').on(table.createdAt, table.id)
  ]
)

/**
 * Workspace data export jobs (ADR 0055). One row per request: `pending` until
 * the background worker builds the archive, then `ready` with the R2 object
 * key, or `failed`. `downloadSecret` is the per-export HMAC key behind the
 * signed download link — both workers share this table, so no cross-worker
 * secret is needed. `expiresAt` mirrors the bucket's lifecycle rule.
 */
export const workspaceExports = sqliteTable(
  'workspace_exports',
  {
    id: id(),
    workspaceId: workspaceRef(),
    // Set null rather than cascade: an export outlives the account that asked
    // for it, and the row is what the audit trail's `targetId` points at.
    requestedByUserId: text('requested_by_user_id').references(() => user.id, {
      onDelete: 'set null'
    }),
    status: text('status', { enum: workspaceExportStatuses })
      .default('pending')
      .notNull(),
    objectKey: text('object_key'),
    sizeBytes: integer('size_bytes'),
    downloadSecret: text('download_secret').notNull(),
    failureReason: text('failure_reason'),
    createdAt: isoCreatedAt(),
    completedAt: text('completed_at'),
    expiresAt: text('expires_at')
  },
  (table) => [
    workspaceIdIndex('workspace_exports', table.workspaceId),
    index('workspace_exports_requested_by_user_id_idx').on(table.requestedByUserId),
    index('workspace_exports_retention_idx').on(table.completedAt, table.id),
    index('workspace_exports_secret_expiry_idx').on(
      sql`CASE WHEN status = 'failed' THEN completed_at ELSE expires_at END`,
      table.id
    ),
    index('workspace_exports_recovery_idx').on(table.status, table.createdAt, table.id)
  ]
)

/** Short lived, session-bound personal archives. The JSON is intentionally
 * stored in D1 so the download remains private and can be removed by the
 * existing retention worker. */
export const personalDataExports = sqliteTable(
  'personal_data_exports',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    sessionId: text('session_id')
      .notNull()
      .references(() => session.id, { onDelete: 'cascade' }),
    archive: text('archive').notNull(),
    conversationManifest: jsonText(
      'personal_data_exports',
      'conversation_manifest',
      Schema.Array(Schema.Struct({ id: Schema.String, policyRevision: Schema.Int }))
    )
      .notNull()
      .default([]),
    createdAt: isoCreatedAt(),
    expiresAt: text('expires_at').notNull()
  },
  (table) => [
    index('personal_data_exports_expiry_idx').on(table.expiresAt, table.id),
    index('personal_data_exports_user_id_idx').on(table.userId),
    index('personal_data_exports_session_id_idx').on(table.sessionId)
  ]
)

/** Operator housekeeping cursors, separate from customer and recovery evidence. */
export const retentionProgress = sqliteTable('retention_progress', {
  recordClass: text('record_class').primaryKey(),
  policyDigest: text('policy_digest').notNull(),
  cursorClock: text('cursor_clock'),
  cursorId: text('cursor_id'),
  lastSuccessAt: text('last_success_at'),
  lastEvaluatedAt: text('last_evaluated_at').notNull(),
  hasMore: integer('has_more', { mode: 'boolean' }).notNull(),
  failure: text('failure')
})
