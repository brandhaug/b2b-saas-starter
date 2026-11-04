import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { Schema } from 'effect'
import { jsonText } from '../json-column.ts'
import { user } from './auth.ts'
import { id, isoCreatedAt } from './columns.ts'

/** The directory keeps immutable cleanup addresses after parent deletion. It contains no transcript. */
export const assistantConversations = sqliteTable(
  'assistant_conversations',
  {
    id: id(),
    workspaceId: text('workspace_id').notNull(),
    creatorUserId: text('creator_user_id').notNull(),
    requiredPermissions: jsonText(
      'assistant_conversations',
      'required_permissions',
      Schema.Array(Schema.String)
    )
      .notNull()
      .default([]),
    policyRevision: integer('policy_revision').notNull().default(0),
    runAccessRevision: integer('run_access_revision').notNull().default(0),
    createdAt: isoCreatedAt(),
    deletedAt: text('deleted_at'),
    cleanedAt: text('cleaned_at')
  },
  (table) => [
    index('assistant_conversations_owner_idx').on(
      table.workspaceId,
      table.creatorUserId,
      table.createdAt,
      table.id
    ),
    index('assistant_conversations_creator_idx').on(table.creatorUserId),
    index('assistant_conversations_cleanup_idx').on(table.deletedAt, table.cleanedAt)
  ]
)

/** Released reservations retain their rate accounting; expiration bounds ambiguous cross-store writes. */
export const assistantReservations = sqliteTable(
  'assistant_reservations',
  {
    id: id(),
    conversationId: text('conversation_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    userId: text('user_id').notNull(),
    createdAt: integer('created_at').notNull(),
    deadline: integer('deadline').notNull(),
    committedAt: integer('committed_at'),
    releasedAt: integer('released_at')
  },
  (table) => [
    index('assistant_reservations_member_idx').on(
      table.workspaceId,
      table.userId,
      table.createdAt
    ),
    index('assistant_reservations_conversation_idx').on(table.conversationId)
  ]
)

/** Session proof retained for accepted runs when the observation credential expires naturally. */
export const assistantSessionAuthority = sqliteTable(
  'assistant_session_authority',
  {
    sessionId: text('session_id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    revokedAt: integer('revoked_at', { mode: 'timestamp' }),
    impersonatedBy: text('impersonated_by'),
    passwordVerifiedAt: integer('password_verified_at', { mode: 'timestamp' }),
    strongAuthAt: integer('strong_auth_at', { mode: 'timestamp' }),
    strongAuthMethod: text('strong_auth_method'),
    strongAuthCredentialId: text('strong_auth_credential_id'),
    recoveryUntil: integer('recovery_until', { mode: 'timestamp' })
  },
  (table) => [index('assistant_session_authority_user_idx').on(table.userId)]
)
