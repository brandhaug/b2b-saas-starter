import { describe, expect, it } from 'vitest'
import { getTableConfig } from 'drizzle-orm/sqlite-core'
import {
  capabilityAggregateRevisions,
  capabilityAudit,
  capabilityCallbackCorrelations,
  capabilityCommands,
  capabilityHistory,
  capabilityOutbox,
  capabilityTransactionGuards,
  merchantAccessHolds
} from './schema.ts'

describe('shared capability canonical schema', () => {
  it('mirrors the migration authority and transaction constraints', () => {
    const callbacks = getTableConfig(capabilityCallbackCorrelations)
    const aggregates = getTableConfig(capabilityAggregateRevisions)
    const commands = getTableConfig(capabilityCommands)
    const history = getTableConfig(capabilityHistory)
    const audit = getTableConfig(capabilityAudit)
    const outbox = getTableConfig(capabilityOutbox)
    const guards = getTableConfig(capabilityTransactionGuards)
    const holds = getTableConfig(merchantAccessHolds)

    expect(callbacks.foreignKeys.map((foreignKey) => foreignKey.getName())).toEqual([
      'capability_callback_correlations_merchant_id_merchants_id_fk'
    ])
    expect(callbacks.indexes.map((index) => index.config.name)).toContain(
      'capability_callback_correlations_expiry_idx'
    )
    expect(aggregates.checks.map((constraint) => constraint.name)).toContain(
      'capability_aggregate_revisions_revision_positive'
    )
    expect(commands.indexes.map((index) => index.config.name)).toContain(
      'capability_commands_aggregate_idx'
    )
    expect(history.indexes.map((index) => index.config.name)).toContain(
      'capability_history_aggregate_revision_unique'
    )
    expect(audit.indexes.map((index) => index.config.name)).toContain(
      'capability_audit_aggregate_revision_unique'
    )
    expect(outbox.indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        'capability_outbox_aggregate_revision_kind_unique',
        'capability_outbox_recovery_idx',
        'capability_outbox_authority_idx'
      ])
    )
    expect(outbox.checks.map((constraint) => constraint.name)).toContain(
      'capability_outbox_status_valid'
    )
    expect(outbox.columns.find((column) => column.name === 'status')?.default).toBe(
      'pending'
    )
    expect(guards.checks.map((constraint) => constraint.name)).toEqual([
      'capability_transaction_guards_accepted'
    ])
    expect(holds.foreignKeys.map((foreignKey) => foreignKey.getName())).toEqual([
      'merchant_access_holds_merchant_id_merchants_id_fk',
      'merchant_access_holds_user_id_user_id_fk'
    ])
    expect(holds.indexes.map((index) => index.config.name)).toContain(
      'merchant_access_holds_active_unique'
    )
  })
})
