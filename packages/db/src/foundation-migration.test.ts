import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applyMigrations, provisionUnmigratedTestD1, type TestD1 } from './testing.ts'

const previousMigration = '20260711010952_cooing_thunderbolt_ross'
let test: TestD1

beforeAll(async () => {
  test = await provisionUnmigratedTestD1()
  await applyMigrations(test.d1, { through: previousMigration })
}, 60_000)
afterAll(async () => test.dispose())

describe('capability foundation migration', () => {
  it('backfills the current first-slice model without changing legacy rows', async () => {
    const now = '2026-07-11T12:00:00.000Z'
    await test.d1
      .prepare(
        `INSERT INTO merchants (id, public_name, slug, timezone, currency, plan, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'solo', ?, ?)`
      )
      .bind('mrc_legacy', 'Legacy Shop', 'legacy-shop', 'UTC', 'EUR', now, now)
      .run()
    await test.d1
      .prepare(
        `INSERT INTO providers (id, merchant_id, display_name, status, is_default, created_at, updated_at)
         VALUES ('prv_legacy', 'mrc_legacy', 'Legacy Provider', 'active', 1, ?, ?)`
      )
      .bind(now, now)
      .run()
    await test.d1
      .prepare(
        `INSERT INTO services (id, merchant_id, name, price_minor, currency, duration_minutes, status, created_at, updated_at)
         VALUES ('svc_primary', 'mrc_legacy', 'Primary', 5000, 'EUR', 60, 'active', ?, ?),
                ('svc_extra', 'mrc_legacy', 'Extra', 1000, 'EUR', 15, 'active', ?, ?)`
      )
      .bind(now, now, now, now)
      .run()
    await test.d1
      .prepare(
        `INSERT INTO booking_sessions
         (id, merchant_id, capability_hash, checkout_path, lifecycle, provider_preference, provider_id, primary_service_id, created_at, last_activity_at, idle_expires_at, absolute_expires_at)
         VALUES (?, ?, ?, 'pay_in_person', 'active', 'specific', 'prv_legacy', 'svc_primary', ?, ?, ?, ?)`
      )
      .bind('bsn_legacy', 'mrc_legacy', 'hash_legacy', now, now, now, now)
      .run()
    await test.d1
      .prepare(
        `INSERT INTO booking_session_additional_services (booking_session_id, service_id, position)
         VALUES ('bsn_legacy', 'svc_extra', 0)`
      )
      .run()
    await test.d1
      .prepare(
        `INSERT INTO time_slot_holds
         (id, merchant_id, booking_session_id, provider_id, starts_at, ends_at, created_at, expires_at, quote)
         VALUES ('hld_legacy', 'mrc_legacy', 'bsn_legacy', 'prv_legacy', '2026-07-12T09:00:00.000Z', '2026-07-12T10:15:00.000Z', ?, '2026-07-11T12:10:00.000Z', ?)`
      )
      .bind(
        now,
        JSON.stringify({
          startsAt: '2026-07-12T09:00:00.000Z',
          endsAt: '2026-07-12T10:15:00.000Z',
          providerPreference: { kind: 'specific', providerId: 'prv_legacy' },
          assignedProvider: { id: 'prv_legacy', displayName: 'Legacy Provider' },
          services: [],
          durationMinutes: 75,
          currency: 'EUR',
          totalMinor: 6000
        })
      )
      .run()

    await applyMigrations(test.d1, { after: previousMigration })

    const shop = await test.d1
      .prepare('SELECT merchant_id, slug, currency FROM shops WHERE id = ?')
      .bind('shp_mrc_legacy')
      .first<{ merchant_id: string; slug: string; currency: string }>()
    const party = await test.d1
      .prepare(
        'SELECT booking_session_id, lifecycle, currency FROM booking_parties WHERE id = ?'
      )
      .bind('bpt_bsn_legacy')
      .first<{ booking_session_id: string; lifecycle: string; currency: string }>()
    const legacyCount = await test.d1
      .prepare('SELECT count(*) AS count FROM booking_sessions WHERE id = ?')
      .bind('bsn_legacy')
      .first<{ count: number }>()
    const request = await test.d1
      .prepare('SELECT starts_at, ends_at FROM booking_requests WHERE id = ?')
      .bind('brq_bsn_legacy')
      .first<{ starts_at: string; ends_at: string }>()
    const requestServices = await test.d1
      .prepare(
        'SELECT service_id, role, position FROM booking_request_services WHERE booking_request_id = ? ORDER BY position'
      )
      .bind('brq_bsn_legacy')
      .all<{ service_id: string; role: string; position: number }>()
    const quote = await test.d1
      .prepare(
        'SELECT currency, total_minor, accepted_at, expires_at FROM pricing_quotes WHERE id = ?'
      )
      .bind('pqt_hld_legacy')
      .first<{
        currency: string
        total_minor: number
        accepted_at: string | null
        expires_at: string
      }>()

    expect(shop).toEqual({
      merchant_id: 'mrc_legacy',
      slug: 'legacy-shop',
      currency: 'EUR'
    })
    expect(party).toEqual({
      booking_session_id: 'bsn_legacy',
      lifecycle: 'active',
      currency: 'EUR'
    })
    expect(legacyCount?.count).toBe(1)
    expect(request).toEqual({
      starts_at: '2026-07-12T09:00:00.000Z',
      ends_at: '2026-07-12T10:15:00.000Z'
    })
    expect(requestServices.results).toEqual([
      { service_id: 'svc_primary', role: 'primary', position: 0 },
      { service_id: 'svc_extra', role: 'additional', position: 1 }
    ])
    expect(quote).toEqual({
      currency: 'EUR',
      total_minor: 6000,
      accepted_at: null,
      expires_at: '2026-07-11T12:10:00.000Z'
    })
  })
})
