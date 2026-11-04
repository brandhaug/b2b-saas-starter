import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { notificationKinds, notificationChannels } from '../enums.ts'
import { user } from './auth.ts'
import { workspaceRefNullable } from './workspaces.ts'
import { id, isoCreatedAt, workspaceIdIndex } from './columns.ts'
import { type JsonObject } from './json.ts'

export const notifications = sqliteTable(
  'notifications',
  {
    id: id(),
    workspaceId: workspaceRefNullable(),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    // What the notification is about; selects the email template and the
    // recipient's channel preference. Rows written before the column existed
    // read as `announcement`.
    kind: text('kind', { enum: notificationKinds }).default('announcement').notNull(),
    title: text('title').notNull(),
    message: text('message').notNull(),
    // Structured data for system notifications. Literal announcements use null;
    // event renderers use the recipient's current locale for system events.
    event: text('event', { mode: 'json' }).$type<JsonObject | null>(),
    readAt: text('read_at'),
    createdAt: isoCreatedAt()
  },
  (table) => [
    workspaceIdIndex('notifications', table.workspaceId),
    index('notifications_retention_idx').on(table.createdAt, table.id),
    index('notifications_user_id_idx').on(table.userId)
  ]
)

/**
 * One row per (user, kind) the user has set explicitly. A missing row means
 * the kind's default channel applies (`instant` for the security kinds,
 * `digest` otherwise) — the defaults live in code, not in seeded rows, so a
 * new kind needs no backfill.
 */
export const notificationPreferences = sqliteTable(
  'notification_preferences',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: notificationKinds }).notNull(),
    channel: text('channel', { enum: notificationChannels }).notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => [
    uniqueIndex('notification_preferences_user_kind_idx').on(table.userId, table.kind)
  ]
)
