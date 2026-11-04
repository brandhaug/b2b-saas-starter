import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { emailPurposes, emailDeliveryStatuses } from '../enums.ts'
import { user } from './auth.ts'
import { workspaces } from './workspaces.ts'

/** Sanitized delivery evidence. Never stores message contents or credentials. */
export const emailDeliveries = sqliteTable(
  'email_deliveries',
  {
    id: text('id').primaryKey(),
    referenceId: text('reference_id'),
    purpose: text('purpose', { enum: emailPurposes }).notNull(),
    recipient: text('recipient').notNull(),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspaces.id, {
      onDelete: 'cascade'
    }),
    status: text('status', { enum: emailDeliveryStatuses }).notNull(),
    providerMessageId: text('provider_message_id'),
    lastEventId: text('last_event_id'),
    lastEventAt: text('last_event_at'),
    reason: text('reason'),
    acceptedAt: text('accepted_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    retryUntil: text('retry_until').notNull(),
    nextAttemptAt: text('next_attempt_at').notNull(),
    attemptCount: integer('attempt_count').notNull(),
    uncertain: integer('uncertain', { mode: 'boolean' }).notNull(),
    token: text('token'),
    revision: integer('revision').notNull()
  },
  (table) => [
    index('email_deliveries_user_idx').on(table.userId, table.createdAt),
    index('email_deliveries_workspace_idx').on(
      table.workspaceId,
      table.purpose,
      table.createdAt
    ),
    index('email_deliveries_provider_idx').on(table.providerMessageId, table.recipient),
    index('email_deliveries_accepted_updated_idx').on(
      table.acceptedAt,
      table.updatedAt
    ),
    index('email_deliveries_status_created_idx').on(table.status, table.createdAt),
    index('email_deliveries_retention_idx').on(table.createdAt, table.id)
  ]
)
