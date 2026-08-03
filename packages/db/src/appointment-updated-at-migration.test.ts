import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyMigrations, provisionUnmigratedTestD1, type TestD1 } from './testing.ts'

const previousMigration = '20260712151036_lonely_sinister_six'
const appointmentPartyMigration = '20260712151200_nasty_demogoblin'
let test: TestD1

beforeAll(async () => {
  test = await provisionUnmigratedTestD1()
  await applyMigrations(test.d1, { through: previousMigration })
}, 60_000)
afterAll(async () => test.dispose())

describe('appointment updated-at migration', () => {
  it('backfills legacy null timestamps while making the column required', async () => {
    const createdAt = '2026-07-10T09:30:00.000Z'

    await test.d1
      .prepare(
        `INSERT INTO merchants
         (id, public_name, slug, timezone, currency, plan, created_at, updated_at)
         VALUES ('mrc_legacy_timestamp', 'Legacy Timestamp', 'legacy-timestamp', 'UTC', 'EUR', 'solo', ?, ?)`
      )
      .bind(createdAt, createdAt)
      .run()
    await test.d1
      .prepare(
        `INSERT INTO providers
         (id, merchant_id, display_name, status, created_at, updated_at)
         VALUES ('prv_legacy_timestamp', 'mrc_legacy_timestamp', 'Legacy Provider', 'active', ?, ?)`
      )
      .bind(createdAt, createdAt)
      .run()
    await test.d1
      .prepare(
        `INSERT INTO appointments
         (id, merchant_id, provider_id, status, starts_at, ends_at, created_at)
         VALUES ('apt_legacy_timestamp', 'mrc_legacy_timestamp', 'prv_legacy_timestamp', 'scheduled', '2026-07-13T09:30:00.000Z', '2026-07-13T10:30:00.000Z', ?)`
      )
      .bind(createdAt)
      .run()

    await applyMigrations(test.d1, {
      after: previousMigration,
      through: appointmentPartyMigration
    })

    const appointment = await test.d1
      .prepare("SELECT updated_at FROM appointments WHERE id = 'apt_legacy_timestamp'")
      .first<{ updated_at: string }>()
    const updatedAtColumn = await test.d1
      .prepare(
        "SELECT [notnull] FROM pragma_table_info('appointments') WHERE name = 'updated_at'"
      )
      .first<{ notnull: number }>()

    expect(appointment).toEqual({ updated_at: createdAt })
    expect(updatedAtColumn).toEqual({ notnull: 1 })
  })
})
