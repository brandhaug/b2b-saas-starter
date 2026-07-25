import { describe, expect, it } from 'vitest'
import { buildSeedSql } from './seed.ts'

describe('Booking seed SQL', () => {
  it('authors the legacy ShopInfo cover, alias, and address', () => {
    const sql = buildSeedSql()

    expect(sql).toContain('photo-1621605815971-fbc98d665033')
    expect(sql).toContain('Mara Ionescu')
    expect(sql).toContain('INSERT OR REPLACE INTO shop_addresses')
    expect(sql).toContain('Strada Lipscani 21')
  })

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

  it('configures Mara prices with included 21% VAT and no booking fee', () => {
    const sql = buildSeedSql()
    const pricingPolicyInsert = sql
      .split('\n')
      .find((statement) =>
        statement.startsWith('INSERT OR REPLACE INTO pricing_policies')
      )

    expect(pricingPolicyInsert).toContain(
      '(shop_id, tax_basis_points, tax_label, tax_included, fee_minor, fee_label'
    )
    expect(pricingPolicyInsert).toContain(
      "'shp_mer_seed_booking_studio', 2100, 'VAT', 1, 0, 'Fee'"
    )
  })
})
