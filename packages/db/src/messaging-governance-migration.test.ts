import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { provisionTestD1, type TestD1 } from './testing.ts'

describe('Messaging governance migration', () => {
  let test: TestD1

  beforeAll(async () => {
    test = await provisionTestD1()
  }, 60_000)

  afterAll(async () => test.dispose())

  it('adds durable cursors, quarantine, append-only resolutions, events, and approvals', async () => {
    const rows = await test.d1
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name IN (
           'messaging_job_cursors',
           'messaging_incident_quarantine',
           'messaging_reconciliation_resolutions',
           'messaging_incident_events',
           'messaging_recovery_approvals'
         ) ORDER BY name`
      )
      .all<{ name: string }>()

    expect(rows.results.map((row) => row.name)).toEqual([
      'messaging_incident_events',
      'messaging_incident_quarantine',
      'messaging_job_cursors',
      'messaging_reconciliation_resolutions',
      'messaging_recovery_approvals'
    ])
  })

  it('prevents a single Operator from supplying both recovery approvals', async () => {
    const at = '2026-07-29T12:00:00.000Z'
    await test.d1
      .prepare(
        `INSERT INTO messaging_incidents
         (id, kind, status, severity, safe_summary, containment_scope,
          opened_by_actor_type, opened_by_actor_id, opened_at, created_at, updated_at)
         VALUES ('minc_migration', 'platform_integrity', 'recovering', 'critical',
          'Integrity recovery', 'global', 'system_operator', 'opr_migration', ?, ?, ?)`
      )
      .bind(at, at, at)
      .run()
    const insert = (id: string) =>
      test.d1
        .prepare(
          `INSERT INTO messaging_recovery_approvals
           (id, incident_id, actor_operator_id, health_probe_reference,
            reconciliation_reference, residual_risk, created_at)
           VALUES (?, 'minc_migration', 'opr_migration', 'probe:one',
            'reconciliation:one', 'low', ?)`
        )
        .bind(id, at)

    await insert('mrap_migration_one').run()
    await expect(insert('mrap_migration_two').run()).rejects.toThrow()
  })
})
