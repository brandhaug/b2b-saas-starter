import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyMigrations, provisionUnmigratedTestD1, type TestD1 } from './testing.ts'

let test: TestD1

beforeAll(async () => {
  test = await provisionUnmigratedTestD1()
}, 60_000)

afterAll(async () => test.dispose())

describe('Customer Directory forward migration', () => {
  it('upgrades a database that already received the previously published guards', async () => {
    await applyMigrations(test.d1, {
      through: '20260803170000_customer_directory_privacy_hardening'
    })
    for (const name of [
      'customer_records_merge_target_insert_guard',
      'customer_records_merge_target_update_guard'
    ])
      await test.d1
        .prepare(
          `CREATE TRIGGER ${name}
           BEFORE UPDATE ON customer_records
           BEGIN SELECT 1; END`
        )
        .run()

    await applyMigrations(test.d1, {
      after: '20260803170000_customer_directory_privacy_hardening'
    })

    const guards = await test.d1
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'trigger' AND name LIKE 'customer_records_merge_target_%'
         ORDER BY name`
      )
      .all<{ name: string }>()
    expect(guards.results.map(({ name }) => name)).toEqual([
      'customer_records_merge_target_delete_guard',
      'customer_records_merge_target_identity_guard',
      'customer_records_merge_target_insert_guard',
      'customer_records_merge_target_update_guard'
    ])
  })
})
