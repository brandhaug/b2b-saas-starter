import { sql } from 'drizzle-orm'
import { check, index, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** Value-free authority deployed outside the primary Merchant restore boundary. */
export const privacyActionLedger = sqliteTable(
  'privacy_action_ledger',
  {
    id: text('id').primaryKey(),
    privacyRequestId: text('privacy_request_id').notNull(),
    actionKey: text('action_key').notNull().unique(),
    actionKind: text('action_kind').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceRef: text('resource_ref').notNull(),
    outcome: text('outcome', {
      enum: ['pending', 'applied', 'held', 'failed']
    }).notNull(),
    policyVersion: text('policy_version').notNull(),
    appliedAt: text('applied_at'),
    createdAt: text('created_at').notNull()
  },
  (table) => [
    index('privacy_action_ledger_replay_idx').on(table.outcome, table.createdAt),
    check(
      'privacy_action_ledger_outcome_valid',
      sql`${table.outcome} IN ('pending','applied','held','failed')`
    )
  ]
)
