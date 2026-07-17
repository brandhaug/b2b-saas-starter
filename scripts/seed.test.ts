import { describe, expect, it } from 'vitest'
import { buildSeedSql } from './seed.ts'

describe('Booking seed SQL', () => {
  it('persists the checkout policy required by the legacy policy step', () => {
    const sql = buildSeedSql()
    const policyInsert = sql
      .split('\n')
      .find((statement) =>
        statement.startsWith('INSERT OR REPLACE INTO checkout_policies')
      )

    expect(policyInsert).toBe(
      "INSERT OR REPLACE INTO checkout_policies (id, kind, version, disclosure, effective_at, retired_at, created_at, merchant_id, brand_id, shop_id, scope, scope_id) VALUES ('pol_seed_checkout', 'checkout', 2, 'Cancel up to 1 hour before the appointment.', '2026-07-10T09:30:00.000Z', NULL, '2026-07-10T09:30:00.000Z', 'mer_seed_booking_studio', NULL, NULL, 'merchant', 'mer_seed_booking_studio');"
    )
  })
})
