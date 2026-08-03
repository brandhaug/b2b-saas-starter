import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyMigrations, provisionUnmigratedTestD1, type TestD1 } from './testing.ts'

const previousMigration = '20260729160000_meta_callback_receipts'
const permissionMigration = '20260729170000_booking_operational_permission'
let test: TestD1

beforeAll(async () => {
  test = await provisionUnmigratedTestD1()
  await applyMigrations(test.d1, { through: previousMigration })
}, 60_000)

afterAll(async () => test.dispose())

describe('Booking Operational Messaging Permission migration', () => {
  it('adds optional independent evidence without inventing permission for existing requests', async () => {
    await applyMigrations(test.d1, {
      after: previousMigration,
      through: permissionMigration
    })
    const columns = await test.d1
      .prepare(`PRAGMA table_info('booking_requests')`)
      .all<{ name: string }>()
    expect(columns.results.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        'operational_messaging_permission_granted',
        'operational_messaging_permission_policy_version',
        'operational_messaging_permission_recorded_at'
      ])
    )
  })
})
