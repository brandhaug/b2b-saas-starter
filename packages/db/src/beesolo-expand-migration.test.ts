import { afterEach, describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import {
  backfillAppointmentFoundations,
  beesoloDurableFactPolicies,
  layerBeesoloMigrationBackfillFromD1
} from './beesolo-expand.ts'
import {
  applyMigrations,
  applyPrivacyLedgerMigrations,
  provisionUnmigratedTestD1,
  type TestD1
} from './testing.ts'

const previousMigration = '20260729200000_solo_entitlement'
const expandMigration = '20260802120000_beesolo_expand'
const allocated: TestD1[] = []
const now = '2026-08-02T12:00:00.000Z'

afterEach(async () => {
  const completed = allocated.splice(0)
  await Promise.all(completed.map((test) => test.dispose()))
})

const provisionPrevious = async () => {
  const test = await provisionUnmigratedTestD1()
  allocated.push(test)
  await applyMigrations(test.d1, { through: previousMigration })
  return test
}

const runBackfill = (
  test: TestD1,
  input: { readonly now: string; readonly limit?: number }
) =>
  Effect.runPromise(
    backfillAppointmentFoundations(input).pipe(
      Effect.provide(layerBeesoloMigrationBackfillFromD1(test.d1))
    )
  )

const insertSoloFixture = async (test: TestD1, appointments = 0) => {
  await test.d1
    .prepare(
      `INSERT INTO user (id, email, name, identityClass, createdAt, updatedAt)
       VALUES ('usr_expand', 'owner@expand.example', 'Owner', 'merchant_member', 1, 1)`
    )
    .run()
  await test.d1
    .prepare(
      `INSERT INTO merchants (id, public_name, slug, timezone, currency, plan, created_at, updated_at)
     VALUES ('mer_expand', 'Expand Studio', 'expand-studio', 'Europe/Bucharest', 'EUR', 'solo', ?, ?)`
    )
    .bind(now, now)
    .run()
  await test.d1
    .prepare(
      `INSERT INTO merchant_memberships (merchant_id, user_id, role, created_at)
       VALUES ('mer_expand', 'usr_expand', 'owner', ?)`
    )
    .bind(now)
    .run()
  await test.d1
    .prepare(
      `INSERT INTO providers (id, merchant_id, linked_user_id, display_name, status, is_default, created_at, updated_at)
     VALUES ('prv_expand', 'mer_expand', 'usr_expand', 'Owner', 'active', 1, ?, ?)`
    )
    .bind(now, now)
    .run()
  await test.d1
    .prepare(
      `INSERT INTO brands (id, merchant_id, name, created_at, updated_at)
       VALUES ('brd_expand', 'mer_expand', 'Expand Studio', ?, ?)`
    )
    .bind(now, now)
    .run()
  await test.d1
    .prepare(
      `INSERT INTO shops
       (id, brand_id, merchant_id, slug, public_name, timezone, currency, created_at, updated_at)
       VALUES ('shp_expand', 'brd_expand', 'mer_expand', 'expand-studio',
               'Expand Studio', 'Europe/Bucharest', 'EUR', ?, ?)`
    )
    .bind(now, now)
    .run()
  await test.d1
    .prepare(
      `INSERT INTO services
       (id, merchant_id, name, price_minor, currency, duration_minutes, status, created_at, updated_at)
       VALUES ('svc_expand', 'mer_expand', 'Haircut', 5000, 'EUR', 60, 'active', ?, ?)`
    )
    .bind(now, now)
    .run()
  await test.d1
    .prepare(
      `INSERT INTO provider_service_eligibility
       (merchant_id, provider_id, service_id, created_at)
       VALUES ('mer_expand', 'prv_expand', 'svc_expand', ?)`
    )
    .bind(now)
    .run()
  for (let index = 0; index < appointments; index += 1) {
    await test.d1
      .prepare(
        `INSERT INTO appointments
       (id, merchant_id, provider_id, status, version, starts_at, ends_at, created_at, updated_at)
       VALUES (?, 'mer_expand', 'prv_expand', 'scheduled', 1, ?, ?, ?, ?)`
      )
      .bind(
        `apt_${String(index).padStart(3, '0')}`,
        `2026-08-${String(index + 3).padStart(2, '0')}T09:00:00.000Z`,
        `2026-08-${String(index + 3).padStart(2, '0')}T10:00:00.000Z`,
        now,
        now
      )
      .run()
  }
}

describe('beesolo expand migration', () => {
  it('reports invalid backfill input through a typed Effect error', async () => {
    const test = await provisionUnmigratedTestD1()
    allocated.push(test)
    for (const input of [
      { now: 42, limit: 1 },
      { now: '2026-99-99T99:99:99Z', limit: 1 }
    ]) {
      const error = await Effect.runPromise(
        Effect.flip(
          backfillAppointmentFoundations(input).pipe(
            Effect.provide(layerBeesoloMigrationBackfillFromD1(test.d1))
          )
        )
      )
      expect(error).toMatchObject({ _tag: 'BeesoloBackfillInputInvalid' })
    }
  })

  it('keeps the Privacy Action Ledger outside the Merchant restore boundary', async () => {
    const merchantStore = await provisionUnmigratedTestD1()
    const privacyLedgerStore = await provisionUnmigratedTestD1()
    allocated.push(merchantStore, privacyLedgerStore)

    await applyMigrations(merchantStore.d1)
    await applyPrivacyLedgerMigrations(privacyLedgerStore.d1)

    const merchantLedger = await merchantStore.d1
      .prepare(
        `SELECT count(*) AS count FROM sqlite_master
         WHERE type = 'table' AND name = 'privacy_action_ledger'`
      )
      .first<{ count: number }>()
    const privacyLedger = await privacyLedgerStore.d1
      .prepare(
        `SELECT count(*) AS count FROM sqlite_master
         WHERE type = 'table' AND name = 'privacy_action_ledger'`
      )
      .first<{ count: number }>()

    expect(merchantLedger?.count).toBe(0)
    expect(privacyLedger?.count).toBe(1)
  }, 60_000)

  it('binds immutable Privacy Request Preflights to the current request revision', async () => {
    const test = await provisionPrevious()
    await insertSoloFixture(test)
    await applyMigrations(test.d1, {
      after: previousMigration,
      through: expandMigration
    })
    await test.d1
      .prepare(
        `INSERT INTO privacy_requests
         (id, merchant_id, request_type, status, destination_fingerprint, locale, revision,
          received_at, verification_expires_at, governing_deadline_at, created_at, updated_at)
         VALUES ('privacy_expand', 'mer_expand', 'access', 'queued_for_review', 'fingerprint',
                 'en', 1, ?, ?, ?, ?, ?)`
      )
      .bind(now, now, now, now, now)
      .run()
    await expect(
      test.d1
        .prepare(
          `INSERT INTO privacy_request_preflights
           (id, privacy_request_id, request_revision, source_revision, policy_version,
            manifest_json, created_at)
           VALUES ('preflight_stale', 'privacy_expand', 2, 'source-1', 'policy-1', '{}', ?)`
        )
        .bind(now)
        .run()
    ).rejects.toThrow(/current Privacy Request revision/)
    await test.d1
      .prepare(
        `INSERT INTO privacy_request_preflights
         (id, privacy_request_id, request_revision, source_revision, policy_version,
          manifest_json, created_at)
         VALUES ('preflight_expand', 'privacy_expand', 1, 'source-1', 'policy-1', '{}', ?)`
      )
      .bind(now)
      .run()
    await test.d1
      .prepare(
        `UPDATE privacy_request_preflights SET approved_at = ? WHERE id = 'preflight_expand'`
      )
      .bind(now)
      .run()
    await expect(
      test.d1
        .prepare(
          `UPDATE privacy_request_preflights
           SET manifest_json = '{"changed":true}' WHERE id = 'preflight_expand'`
        )
        .run()
    ).rejects.toThrow(/immutable/)
    await expect(
      test.d1
        .prepare(`DELETE FROM privacy_request_preflights WHERE id = 'preflight_expand'`)
        .run()
    ).rejects.toThrow(/immutable/)
    await test.d1
      .prepare(
        `UPDATE privacy_requests SET revision = 2, updated_at = ? WHERE id = 'privacy_expand'`
      )
      .bind(now)
      .run()
    const invalidated = await test.d1
      .prepare(
        `SELECT approved_at, invalidated_at FROM privacy_request_preflights
         WHERE id = 'preflight_expand'`
      )
      .first<{ approved_at: string | null; invalidated_at: string | null }>()
    expect(invalidated?.approved_at).toBe(now)
    expect(invalidated?.invalidated_at).not.toBeNull()
  }, 60_000)

  it('creates an empty real D1 and accounts for every durable fact policy', async () => {
    const test = await provisionUnmigratedTestD1()
    allocated.push(test)
    await applyMigrations(test.d1)

    const tables = await test.d1
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN
       ('merchant_subscriptions','customer_records','appointment_foundations',
        'appointment_series','external_collections','privacy_requests',
        'report_exports','beesolo_migration_jobs')`
      )
      .all<{ name: string }>()
    expect(tables.results).toHaveLength(8)
    expect(beesoloDurableFactPolicies).toHaveLength(8)
    for (const policy of beesoloDurableFactPolicies) {
      expect(Object.values(policy).every((value) => value.length > 0)).toBe(true)
    }
  }, 60_000)

  it('upgrades a production-shaped Solo graph without changing old rows', async () => {
    const test = await provisionPrevious()
    await insertSoloFixture(test, 2)
    await test.d1
      .prepare(
        `INSERT INTO booking_sessions
         (id, merchant_id, capability_hash, checkout_path, lifecycle,
          provider_preference, provider_id, primary_service_id,
          customer_name, customer_email, locale, embedding_profile,
          created_at, last_activity_at, idle_expires_at, absolute_expires_at)
         VALUES ('bks_expand', 'mer_expand', 'capability-expand', 'pay_in_person',
                 'consumed', 'specific', 'prv_expand', 'svc_expand',
                 'Ada Customer', 'ada@example.com', 'en', 'standalone',
                 ?, ?, '2026-08-02T12:30:00.000Z', '2026-08-03T12:00:00.000Z')`
      )
      .bind(now, now)
      .run()
    await test.d1
      .prepare(
        `UPDATE appointments
         SET booking_session_id = 'bks_expand',
             snapshot = ?,
             updated_at = ?
         WHERE id = 'apt_000'`
      )
      .bind(
        JSON.stringify({
          merchant: { id: 'mer_expand', name: 'Expand Studio' },
          provider: { id: 'prv_expand', name: 'Owner' },
          services: [{ id: 'svc_expand', name: 'Haircut', priceMinor: 5000 }],
          customer: { name: 'Ada Customer', email: 'ada@example.com' },
          totalMinor: 5000,
          currency: 'EUR'
        }),
        now
      )
      .run()
    const before = await test.d1
      .prepare(
        `SELECT (SELECT count(*) FROM merchants) merchants,
              (SELECT count(*) FROM providers) providers,
              (SELECT count(*) FROM merchant_memberships) memberships,
              (SELECT count(*) FROM shops) shops,
              (SELECT count(*) FROM services) services,
              (SELECT count(*) FROM provider_service_eligibility) eligibility,
              (SELECT count(*) FROM booking_sessions) booking_sessions,
              (SELECT count(*) FROM appointments) appointments,
              (SELECT count(*) FROM appointments WHERE snapshot IS NOT NULL) snapshots`
      )
      .first<Record<string, number>>()

    await applyMigrations(test.d1, {
      after: previousMigration,
      through: expandMigration
    })

    const after = await test.d1
      .prepare(
        `SELECT (SELECT count(*) FROM merchants) merchants,
              (SELECT count(*) FROM providers) providers,
              (SELECT count(*) FROM merchant_memberships) memberships,
              (SELECT count(*) FROM shops) shops,
              (SELECT count(*) FROM services) services,
              (SELECT count(*) FROM provider_service_eligibility) eligibility,
              (SELECT count(*) FROM booking_sessions) booking_sessions,
              (SELECT count(*) FROM appointments) appointments,
              (SELECT count(*) FROM appointments WHERE snapshot IS NOT NULL) snapshots,
              (SELECT count(*) FROM appointment_foundations) foundations`
      )
      .first<Record<string, number>>()
    expect(before).toEqual({
      merchants: 1,
      providers: 1,
      memberships: 1,
      shops: 1,
      services: 1,
      eligibility: 1,
      booking_sessions: 1,
      appointments: 2,
      snapshots: 1
    })
    expect(after).toEqual({ ...before, foundations: 0 })
  }, 60_000)

  it('enforces Merchant ownership and complete Appointment Series membership', async () => {
    const test = await provisionPrevious()
    await insertSoloFixture(test, 2)
    await test.d1
      .prepare(
        `INSERT INTO user (id, email, name, identityClass, createdAt, updatedAt)
         VALUES ('usr_other', 'owner@other.example', 'Other Owner', 'merchant_member', 1, 1)`
      )
      .run()
    await test.d1
      .prepare(
        `INSERT INTO merchants (id, public_name, slug, timezone, currency, plan, created_at, updated_at)
         VALUES ('mer_other', 'Other Studio', 'other-studio', 'UTC', 'EUR', 'solo', ?, ?)`
      )
      .bind(now, now)
      .run()

    await test.d1
      .prepare(
        `INSERT INTO merchant_memberships (merchant_id, user_id, role, created_at)
         VALUES ('mer_other', 'usr_other', 'owner', ?)`
      )
      .bind(now)
      .run()
    await test.d1
      .prepare(
        `INSERT INTO providers (id, merchant_id, linked_user_id, display_name, status, is_default, created_at, updated_at)
         VALUES ('prv_other', 'mer_other', 'usr_other', 'Other Owner', 'active', 1, ?, ?)`
      )
      .bind(now, now)
      .run()
    await test.d1
      .prepare(
        `INSERT INTO brands (id, merchant_id, name, created_at, updated_at)
         VALUES ('brd_other', 'mer_other', 'Other Studio', ?, ?)`
      )
      .bind(now, now)
      .run()
    await test.d1
      .prepare(
        `INSERT INTO shops
         (id, brand_id, merchant_id, slug, public_name, timezone, currency, created_at, updated_at)
         VALUES ('shp_other', 'brd_other', 'mer_other', 'other-studio',
                 'Other Studio', 'UTC', 'EUR', ?, ?)`
      )
      .bind(now, now)
      .run()
    await applyMigrations(test.d1, {
      after: previousMigration,
      through: expandMigration
    })
    await test.d1
      .prepare(
        `INSERT INTO customer_records
         (id, merchant_id, display_name, status, preferred_locale, revision, last_activity_at, created_at, updated_at)
         VALUES ('cus_other', 'mer_other', 'Other Customer', 'active', 'en', 1, ?, ?, ?)`
      )
      .bind(now, now, now)
      .run()

    await expect(
      test.d1
        .prepare(
          `INSERT INTO customer_contacts
           (id, customer_record_id, merchant_id, kind, normalized_value, status, is_preferred, created_at, updated_at)
           VALUES ('con_cross', 'cus_other', 'mer_expand', 'email', 'cross@example.com', 'active', 1, ?, ?)`
        )
        .bind(now, now)
        .run()
    ).rejects.toThrow()
    await expect(
      test.d1
        .prepare(
          `INSERT INTO external_collections
           (id, merchant_id, appointment_id, idempotency_key, kind, method, amount_minor,
            currency, actor_id, recorded_at, created_at)
           VALUES ('ext_cross', 'mer_other', 'apt_000', 'cross', 'collection', 'cash',
                   1000, 'EUR', 'usr_other', ?, ?)`
        )
        .bind(now, now)
        .run()
    ).rejects.toThrow()

    await test.d1
      .prepare(
        `INSERT INTO appointment_series
         (id, merchant_id, idempotency_key, service_snapshot_json, customer_snapshot_json,
          weekday, local_start_time, interval_weeks, occurrence_count, status, created_at, updated_at)
         VALUES ('ser_expand', 'mer_expand', 'series-key', '{}', '{}', 1, '09:00', 2, 3, 'active', ?, ?)`
      )
      .bind(now, now)
      .run()

    await test.d1
      .prepare(
        `INSERT INTO appointment_foundations
         (appointment_id, merchant_id, origin, series_id, series_position, foundation_version, created_at)
         VALUES ('apt_000', 'mer_expand', 'merchant_created', 'ser_expand', 1, 1, ?)`
      )
      .bind(now)
      .run()
    await expect(
      test.d1
        .prepare(
          `UPDATE appointment_foundations
           SET appointment_id = 'apt_001'
           WHERE appointment_id = 'apt_000'`
        )
        .run()
    ).rejects.toThrow(/identity/)
    await expect(
      test.d1
        .prepare(`DELETE FROM appointment_foundations WHERE appointment_id = 'apt_000'`)
        .run()
    ).rejects.toThrow(/requires its foundation/)
    await expect(
      test.d1
        .prepare(
          `UPDATE appointment_foundations
           SET series_position = 2
           WHERE appointment_id = 'apt_000'`
        )
        .run()
    ).rejects.toThrow(/immutable/)
    await expect(
      test.d1
        .prepare(
          `UPDATE appointment_foundations
           SET series_id = NULL, series_position = NULL
           WHERE appointment_id = 'apt_000'`
        )
        .run()
    ).rejects.toThrow(/immutable/)
    await expect(
      test.d1
        .prepare(
          `UPDATE appointment_foundations
           SET merchant_id = 'mer_other'
           WHERE appointment_id = 'apt_000'`
        )
        .run()
    ).rejects.toThrow()
    await expect(
      test.d1
        .prepare(
          `UPDATE appointment_series
           SET occurrence_count = 4
           WHERE id = 'ser_expand'`
        )
        .run()
    ).rejects.toThrow(/immutable/)
    await test.d1
      .prepare(
        `UPDATE appointment_series
         SET status = 'cancelled_remaining', updated_at = ?
         WHERE id = 'ser_expand'`
      )
      .bind(now)
      .run()
    await expect(
      test.d1.prepare(`DELETE FROM appointment_series WHERE id = 'ser_expand'`).run()
    ).rejects.toThrow(/immutable/)
    await expect(
      test.d1
        .prepare(
          `INSERT INTO appointment_foundations
           (appointment_id, merchant_id, origin, series_id, series_position, foundation_version, created_at)
           VALUES ('apt_000', 'mer_expand', 'merchant_created', 'ser_expand', 3, 1, ?)`
        )
        .bind(now)
        .run()
    ).rejects.toThrow()
    await expect(
      test.d1
        .prepare(
          `INSERT INTO appointment_series
           (id, merchant_id, idempotency_key, service_snapshot_json, customer_snapshot_json,
            weekday, local_start_time, interval_weeks, occurrence_count, status, created_at, updated_at)
           VALUES ('ser_invalid', 'mer_expand', 'series-invalid', '{}', '{}', 1, '09:00', 9, 3, 'active', ?, ?)`
        )
        .bind(now, now)
        .run()
    ).rejects.toThrow()
    await expect(
      test.d1
        .prepare(
          `INSERT INTO appointment_series
           (id, merchant_id, idempotency_key, service_snapshot_json, customer_snapshot_json,
            weekday, local_start_time, interval_weeks, occurrence_count, status, created_at, updated_at)
           VALUES ('ser_invalid_time', 'mer_expand', 'series-invalid-time', '{}', '{}', 1, '25:99', 2, 3, 'active', ?, ?)`
        )
        .bind(now, now)
        .run()
    ).rejects.toThrow()
  }, 60_000)

  it('keeps External Collections attributed and append-only', async () => {
    const test = await provisionPrevious()
    await insertSoloFixture(test, 1)
    await applyMigrations(test.d1, {
      after: previousMigration,
      through: expandMigration
    })
    await test.d1
      .prepare(`UPDATE appointments SET snapshot = ? WHERE id = 'apt_000'`)
      .bind(JSON.stringify({ totalMinor: 5000.5, currency: 'EUR' }))
      .run()
    await expect(
      test.d1
        .prepare(
          `INSERT INTO external_collections
           (id, merchant_id, appointment_id, idempotency_key, kind, method, amount_minor,
            currency, actor_id, recorded_at, created_at)
           VALUES ('ext_fractional_total', 'mer_expand', 'apt_000', 'fractional-total',
                   'collection', 'cash', 1000, 'EUR', 'usr_expand', ?, ?)`
        )
        .bind(now, now)
        .run()
    ).rejects.toThrow(/net/)
    await test.d1
      .prepare(`UPDATE appointments SET snapshot = ? WHERE id = 'apt_000'`)
      .bind(JSON.stringify({ totalMinor: 5000, currency: 'EUR' }))
      .run()

    await test.d1
      .prepare(
        `INSERT INTO external_collections
         (id, merchant_id, appointment_id, idempotency_key, kind, method, amount_minor,
          currency, actor_id, note_or_reference, recorded_at, created_at)
         VALUES ('ext_original', 'mer_expand', 'apt_000', 'ext-original', 'collection',
                 'cash', 1000, 'EUR', 'usr_expand', 'receipt 7', ?, ?)`
      )
      .bind(now, now)
      .run()

    await expect(
      test.d1
        .prepare(
          `INSERT INTO external_collections
           (id, merchant_id, appointment_id, idempotency_key, kind, method, amount_minor,
            currency, actor_id, recorded_at, created_at)
           VALUES ('ext_impossible_return', 'mer_expand', 'apt_000', 'impossible-return',
                   'return', 'cash', 1001, 'EUR', 'usr_expand', ?, ?)`
        )
        .bind(now, now)
        .run()
    ).rejects.toThrow(/net/)
    await expect(
      test.d1
        .prepare(
          `INSERT INTO external_collections
           (id, merchant_id, appointment_id, idempotency_key, kind, method, amount_minor,
            currency, actor_id, recorded_at, created_at)
           VALUES ('ext_over_collection', 'mer_expand', 'apt_000', 'over-collection',
                   'collection', 'cash', 4001, 'EUR', 'usr_expand', ?, ?)`
        )
        .bind(now, now)
        .run()
    ).rejects.toThrow(/net/)
    await expect(
      test.d1
        .prepare(
          `INSERT INTO external_collections
           (id, merchant_id, appointment_id, idempotency_key, kind, method, amount_minor,
            currency, actor_id, recorded_at, created_at)
           VALUES ('ext_wrong_currency', 'mer_expand', 'apt_000', 'wrong-currency',
                   'collection', 'cash', 100, 'USD', 'usr_expand', ?, ?)`
        )
        .bind(now, now)
        .run()
    ).rejects.toThrow(/currency/)

    await expect(
      test.d1
        .prepare(
          `UPDATE external_collections SET amount_minor = 900 WHERE id = 'ext_original'`
        )
        .run()
    ).rejects.toThrow(/append-only/)
    await expect(
      test.d1
        .prepare(`DELETE FROM external_collections WHERE id = 'ext_original'`)
        .run()
    ).rejects.toThrow(/append-only/)
    await expect(
      test.d1
        .prepare(
          `INSERT INTO external_collections
           (id, merchant_id, appointment_id, idempotency_key, kind, method, amount_minor,
            currency, actor_id, offsets_entry_id, recorded_at, created_at)
           VALUES ('ext_bad_offset', 'mer_expand', 'apt_000', 'ext-bad-offset', 'return',
                   'cash', 1000, 'EUR', 'usr_expand', 'ext_original', ?, ?)`
        )
        .bind(now, now)
        .run()
    ).rejects.toThrow()
    await expect(
      test.d1
        .prepare(
          `INSERT INTO external_collections
           (id, merchant_id, appointment_id, idempotency_key, kind, method, amount_minor,
            currency, actor_id, offsets_entry_id, correction_reason, recorded_at, created_at)
           VALUES ('ext_wrong_kind_offset', 'mer_expand', 'apt_000', 'wrong-kind-offset',
                   'collection', 'cash', 1000, 'EUR', 'usr_expand', 'ext_original',
                   'correct original entry', ?, ?)`
        )
        .bind(now, now)
        .run()
    ).rejects.toThrow(/offset/)
    await expect(
      test.d1
        .prepare(
          `INSERT INTO external_collections
           (id, merchant_id, appointment_id, idempotency_key, kind, method, amount_minor,
            currency, actor_id, offsets_entry_id, correction_reason, recorded_at, created_at)
           VALUES ('ext_partial_offset', 'mer_expand', 'apt_000', 'partial-offset',
                   'return', 'cash', 900, 'EUR', 'usr_expand', 'ext_original',
                   'correct original entry', ?, ?)`
        )
        .bind(now, now)
        .run()
    ).rejects.toThrow(/offset/)
    await test.d1
      .prepare(
        `INSERT INTO external_collections
         (id, merchant_id, appointment_id, idempotency_key, kind, method, amount_minor,
          currency, actor_id, offsets_entry_id, correction_reason, recorded_at, created_at)
         VALUES ('ext_valid_offset', 'mer_expand', 'apt_000', 'valid-offset',
                 'return', 'cash', 1000, 'EUR', 'usr_expand', 'ext_original',
                 'correct original entry', ?, ?)`
      )
      .bind(now, now)
      .run()
    await test.d1
      .prepare(
        `INSERT INTO external_collections
         (id, merchant_id, appointment_id, idempotency_key, kind, method, amount_minor,
          currency, actor_id, recorded_at, created_at)
         VALUES ('ext_second', 'mer_expand', 'apt_000', 'second-entry',
                 'collection', 'cash', 1000, 'EUR', 'usr_expand', ?, ?)`
      )
      .bind(now, now)
      .run()
    await expect(
      test.d1
        .prepare(
          `INSERT INTO external_collections
           (id, merchant_id, appointment_id, idempotency_key, kind, method, amount_minor,
            currency, actor_id, offsets_entry_id, correction_reason, recorded_at, created_at)
           VALUES ('ext_duplicate_offset', 'mer_expand', 'apt_000', 'duplicate-offset',
                   'return', 'cash', 1000, 'EUR', 'usr_expand', 'ext_original',
                   'second correction', ?, ?)`
        )
        .bind(now, now)
        .run()
    ).rejects.toThrow()
    await expect(
      test.d1
        .prepare(`UPDATE appointments SET snapshot = '{}' WHERE id = 'apt_000'`)
        .run()
    ).rejects.toThrow()
    await expect(
      test.d1
        .prepare(`UPDATE appointments SET snapshot = ? WHERE id = 'apt_000'`)
        .bind(JSON.stringify({ totalMinor: 2000.5, currency: 'EUR' }))
        .run()
    ).rejects.toThrow(/net/)
    await expect(
      test.d1
        .prepare(`UPDATE appointments SET snapshot = ? WHERE id = 'apt_000'`)
        .bind(JSON.stringify({ totalMinor: 5000, currency: 'USD' }))
        .run()
    ).rejects.toThrow(/currency/)
    await expect(
      test.d1
        .prepare(`UPDATE appointments SET snapshot = ? WHERE id = 'apt_000'`)
        .bind(JSON.stringify({ totalMinor: 999, currency: 'EUR' }))
        .run()
    ).rejects.toThrow(/net/)
    await test.d1
      .prepare(`UPDATE appointments SET snapshot = ? WHERE id = 'apt_000'`)
      .bind(
        JSON.stringify({
          totalMinor: 2000,
          currency: 'EUR',
          customerDetails: {
            name: 'Erased customer',
            email: 'erased@invalid',
            phone: null
          }
        })
      )
      .run()
  }, 60_000)

  it('unlinks a deleted Customer Record without clearing Appointment ownership', async () => {
    const test = await provisionPrevious()
    await insertSoloFixture(test, 1)
    await applyMigrations(test.d1, {
      after: previousMigration,
      through: expandMigration
    })
    await test.d1
      .prepare(
        `INSERT INTO customer_records
         (id, merchant_id, display_name, status, preferred_locale, revision,
          last_activity_at, created_at, updated_at)
         VALUES ('cus_expand', 'mer_expand', 'Ada Customer', 'active', 'en', 1, ?, ?, ?)`
      )
      .bind(now, now, now)
      .run()
    await test.d1
      .prepare(
        `INSERT INTO appointment_foundations
         (appointment_id, merchant_id, customer_record_id, origin, foundation_version, created_at)
         VALUES ('apt_000', 'mer_expand', 'cus_expand', 'merchant_created', 1, ?)`
      )
      .bind(now)
      .run()

    await test.d1.prepare(`DELETE FROM customer_records WHERE id = 'cus_expand'`).run()
    const foundation = await test.d1
      .prepare(
        `SELECT merchant_id, customer_record_id
         FROM appointment_foundations WHERE appointment_id = 'apt_000'`
      )
      .first<{ merchant_id: string; customer_record_id: string | null }>()
    expect(foundation).toEqual({ merchant_id: 'mer_expand', customer_record_id: null })
  }, 60_000)

  it('fails preflight before durable schema or row changes', async () => {
    const test = await provisionPrevious()
    await test.d1.prepare('DROP TRIGGER merchants_plan_insert').run()
    await test.d1.prepare('DROP TRIGGER merchants_plan_update').run()
    await insertSoloFixture(test)
    await test.d1
      .prepare(
        `INSERT INTO merchants (id, public_name, slug, timezone, currency, plan, created_at, updated_at)
       VALUES ('mer_team', 'Incompatible', 'incompatible', 'UTC', 'EUR', 'team', ?, ?)`
      )
      .bind(now, now)
      .run()
    await test.d1
      .prepare(
        `INSERT INTO providers (id, merchant_id, display_name, status, is_default, created_at, updated_at)
       VALUES ('prv_team', 'mer_team', 'Owner', 'active', 1, ?, ?)`
      )
      .bind(now, now)
      .run()
    const before = await test.d1
      .prepare('SELECT id, plan FROM merchants ORDER BY id')
      .all()
    const schemaBefore = await test.d1
      .prepare(
        `SELECT type, name, tbl_name, sql FROM sqlite_master
         WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`
      )
      .all()

    await expect(
      applyMigrations(test.d1, {
        after: previousMigration,
        through: expandMigration
      })
    ).rejects.toThrow()

    const after = await test.d1
      .prepare('SELECT id, plan FROM merchants ORDER BY id')
      .all()
    const schemaAfter = await test.d1
      .prepare(
        `SELECT type, name, tbl_name, sql FROM sqlite_master
         WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`
      )
      .all()
    const newTable = await test.d1
      .prepare(
        `SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'merchant_subscriptions'`
      )
      .first<{ count: number }>()
    expect(after.results).toEqual(before.results)
    expect(schemaAfter.results).toEqual(schemaBefore.results)
    expect(newTable?.count).toBe(0)
  }, 60_000)

  it('rejects a graph whose sole Provider is not the Merchant Owner', async () => {
    const test = await provisionPrevious()
    await insertSoloFixture(test)
    await test.d1
      .prepare(`UPDATE providers SET linked_user_id = NULL WHERE id = 'prv_expand'`)
      .run()

    await expect(
      applyMigrations(test.d1, {
        after: previousMigration,
        through: expandMigration
      })
    ).rejects.toThrow()
    const newTable = await test.d1
      .prepare(
        `SELECT count(*) AS count FROM sqlite_master
         WHERE type = 'table' AND name = 'merchant_subscriptions'`
      )
      .first<{ count: number }>()
    expect(newTable?.count).toBe(0)
  }, 60_000)

  it('rejects existing cross-Merchant Provider eligibility without changing schema', async () => {
    const test = await provisionPrevious()
    await insertSoloFixture(test)
    await test.d1
      .prepare(
        `INSERT INTO user (id, email, name, identityClass, createdAt, updatedAt)
         VALUES ('usr_elig_other', 'elig-other@example.com', 'Other Owner',
                 'merchant_member', 1, 1)`
      )
      .run()
    await test.d1
      .prepare(
        `INSERT INTO merchants
         (id, public_name, slug, timezone, currency, plan, created_at, updated_at)
         VALUES ('mer_elig_other', 'Other Studio', 'elig-other', 'UTC', 'EUR', 'solo', ?, ?)`
      )
      .bind(now, now)
      .run()
    await test.d1
      .prepare(
        `INSERT INTO merchant_memberships (merchant_id, user_id, role, created_at)
         VALUES ('mer_elig_other', 'usr_elig_other', 'owner', ?)`
      )
      .bind(now)
      .run()
    await test.d1
      .prepare(
        `INSERT INTO providers
         (id, merchant_id, linked_user_id, display_name, status, is_default, created_at, updated_at)
         VALUES ('prv_elig_other', 'mer_elig_other', 'usr_elig_other', 'Other Owner',
                 'active', 1, ?, ?)`
      )
      .bind(now, now)
      .run()
    await test.d1
      .prepare(
        `INSERT INTO brands (id, merchant_id, name, created_at, updated_at)
         VALUES ('brd_elig_other', 'mer_elig_other', 'Other Studio', ?, ?)`
      )
      .bind(now, now)
      .run()
    await test.d1
      .prepare(
        `INSERT INTO shops
         (id, brand_id, merchant_id, slug, public_name, timezone, currency, created_at, updated_at)
         VALUES ('shp_elig_other', 'brd_elig_other', 'mer_elig_other', 'elig-other',
                 'Other Studio', 'UTC', 'EUR', ?, ?)`
      )
      .bind(now, now)
      .run()
    await test.d1
      .prepare(
        `INSERT INTO services
         (id, merchant_id, name, price_minor, currency, duration_minutes, status, created_at, updated_at)
         VALUES ('svc_elig_other', 'mer_elig_other', 'Other Service', 2000, 'EUR', 30,
                 'active', ?, ?)`
      )
      .bind(now, now)
      .run()
    await test.d1
      .prepare('DROP TRIGGER provider_service_eligibility_merchant_insert')
      .run()
    await test.d1
      .prepare('DROP TRIGGER provider_service_eligibility_merchant_update')
      .run()
    await test.d1
      .prepare(
        `INSERT INTO provider_service_eligibility
         (merchant_id, provider_id, service_id, created_at)
         VALUES ('mer_elig_other', 'prv_elig_other', 'svc_elig_other', ?),
                ('mer_expand', 'prv_elig_other', 'svc_expand', ?)`
      )
      .bind(now, now)
      .run()
    const schemaBefore = await test.d1
      .prepare(
        `SELECT type, name, tbl_name, sql FROM sqlite_master
         WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`
      )
      .all()

    await expect(
      applyMigrations(test.d1, {
        after: previousMigration,
        through: expandMigration
      })
    ).rejects.toThrow()
    const schemaAfter = await test.d1
      .prepare(
        `SELECT type, name, tbl_name, sql FROM sqlite_master
         WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`
      )
      .all()
    expect(schemaAfter.results).toEqual(schemaBefore.results)
  }, 60_000)

  it('rejects an existing cross-Merchant Brand and Shop without changing schema', async () => {
    const test = await provisionPrevious()
    await insertSoloFixture(test)
    await test.d1
      .prepare(
        `INSERT INTO user (id, email, name, identityClass, createdAt, updatedAt)
         VALUES ('usr_brand_other', 'brand-other@example.com', 'Other',
                 'merchant_member', 1, 1)`
      )
      .run()
    await test.d1
      .prepare(
        `INSERT INTO merchants
         (id, public_name, slug, timezone, currency, plan, created_at, updated_at)
         VALUES ('mer_brand_other', 'Other Brand Studio', 'other-brand-studio',
                 'UTC', 'EUR', 'solo', ?, ?)`
      )
      .bind(now, now)
      .run()
    await test.d1
      .prepare(
        `INSERT INTO merchant_memberships (merchant_id, user_id, role, created_at)
         VALUES ('mer_brand_other', 'usr_brand_other', 'owner', ?)`
      )
      .bind(now)
      .run()
    await test.d1
      .prepare(
        `INSERT INTO providers
         (id, merchant_id, linked_user_id, display_name, status, is_default, created_at, updated_at)
         VALUES ('prv_brand_other', 'mer_brand_other', 'usr_brand_other', 'Other',
                 'active', 1, ?, ?)`
      )
      .bind(now, now)
      .run()
    await test.d1
      .prepare(
        `INSERT INTO brands (id, merchant_id, name, created_at, updated_at)
         VALUES ('brd_brand_other', 'mer_brand_other', 'Other Brand', ?, ?)`
      )
      .bind(now, now)
      .run()
    await test.d1
      .prepare(
        `INSERT INTO shops
         (id, brand_id, merchant_id, slug, public_name, timezone, currency, created_at, updated_at)
         VALUES ('shp_brand_other', 'brd_expand', 'mer_brand_other', 'other-brand-shop',
                 'Other Shop', 'UTC', 'EUR', ?, ?)`
      )
      .bind(now, now)
      .run()
    await test.d1
      .prepare(`UPDATE shops SET brand_id = 'brd_brand_other' WHERE id = 'shp_expand'`)
      .run()

    await expect(
      applyMigrations(test.d1, {
        after: previousMigration,
        through: expandMigration
      })
    ).rejects.toThrow()
    const productTables = await test.d1
      .prepare(
        `SELECT count(*) AS count FROM sqlite_master
         WHERE type = 'table' AND name = 'merchant_subscriptions'`
      )
      .first<{ count: number }>()
    expect(productTables?.count).toBe(0)
  }, 60_000)

  it('keeps the Solo Owner-Provider and sole Shop graph coherent after upgrade', async () => {
    const test = await provisionPrevious()
    await insertSoloFixture(test)
    await applyMigrations(test.d1, {
      after: previousMigration,
      through: expandMigration
    })

    await expect(
      test.d1
        .prepare(`UPDATE merchants SET plan = 'team' WHERE id = 'mer_expand'`)
        .run()
    ).rejects.toThrow(/invalid merchant plan/)
    await expect(
      test.d1
        .prepare(
          `INSERT INTO merchants
           (id, public_name, slug, timezone, currency, plan, created_at, updated_at)
           VALUES ('mer_team_after', 'Team Studio', 'team-after', 'UTC', 'EUR', 'team', ?, ?)`
        )
        .bind(now, now)
        .run()
    ).rejects.toThrow(/invalid merchant plan/)
    await expect(
      test.d1
        .prepare(`UPDATE providers SET linked_user_id = NULL WHERE id = 'prv_expand'`)
        .run()
    ).rejects.toThrow(/Owner-Provider/)
    await test.d1
      .prepare(
        `INSERT INTO user (id, email, name, identityClass, createdAt, updatedAt)
         VALUES ('usr_replacement', 'replacement@expand.example', 'Replacement',
                 'merchant_member', 1, 1)`
      )
      .run()
    await expect(
      test.d1
        .prepare(
          `INSERT INTO merchant_memberships (merchant_id, user_id, role, created_at)
           VALUES ('mer_expand', 'usr_replacement', 'owner', ?)`
        )
        .bind(now)
        .run()
    ).rejects.toThrow(/UNIQUE/)
    await expect(
      test.d1
        .prepare(
          `UPDATE merchant_memberships
           SET user_id = 'usr_replacement'
           WHERE merchant_id = 'mer_expand'`
        )
        .run()
    ).rejects.toThrow(/Owner membership/)
    await expect(
      test.d1
        .prepare(
          `DELETE FROM merchant_memberships
           WHERE merchant_id = 'mer_expand' AND user_id = 'usr_expand'`
        )
        .run()
    ).rejects.toThrow(/Owner membership/)
    await test.d1
      .prepare(
        `INSERT INTO merchants
         (id, public_name, slug, timezone, currency, plan, created_at, updated_at)
         VALUES ('mer_new', 'New Studio', 'new-studio', 'UTC', 'EUR', 'solo', ?, ?)`
      )
      .bind(now, now)
      .run()
    await test.d1
      .prepare(
        `INSERT INTO merchant_memberships (merchant_id, user_id, role, created_at)
         VALUES ('mer_new', 'usr_replacement', 'owner', ?)`
      )
      .bind(now)
      .run()
    await test.d1
      .prepare(
        `INSERT INTO services
         (id, merchant_id, name, price_minor, currency, duration_minutes, status, created_at, updated_at)
         VALUES ('svc_new', 'mer_new', 'New Service', 3000, 'EUR', 30, 'active', ?, ?)`
      )
      .bind(now, now)
      .run()
    await expect(
      test.d1
        .prepare(
          `INSERT INTO providers
           (id, merchant_id, linked_user_id, display_name, status, is_default, created_at, updated_at)
           VALUES ('prv_new', 'mer_new', NULL, 'New Owner', 'active', 1, ?, ?)`
        )
        .bind(now, now)
        .run()
    ).rejects.toThrow(/Owner-Provider/)
    await test.d1
      .prepare(
        `INSERT INTO providers
         (id, merchant_id, linked_user_id, display_name, status, is_default, created_at, updated_at)
         VALUES ('prv_new', 'mer_new', 'usr_replacement', 'New Owner', 'active', 1, ?, ?)`
      )
      .bind(now, now)
      .run()
    const reconciledEligibility = await test.d1
      .prepare(
        `SELECT count(*) AS count FROM provider_service_eligibility
         WHERE merchant_id = 'mer_new' AND provider_id = 'prv_new' AND service_id = 'svc_new'`
      )
      .first<{ count: number }>()
    expect(reconciledEligibility?.count).toBe(1)
    await expect(
      test.d1
        .prepare(
          `INSERT INTO shops
           (id, brand_id, merchant_id, slug, public_name, timezone, currency, created_at, updated_at)
           VALUES ('shp_second', 'brd_expand', 'mer_expand', 'expand-second',
                   'Expand Second', 'Europe/Bucharest', 'EUR', ?, ?)`
        )
        .bind(now, now)
        .run()
    ).rejects.toThrow(/one Shop/)
    await test.d1
      .prepare(
        `INSERT INTO brands (id, merchant_id, name, created_at, updated_at)
         VALUES ('brd_new', 'mer_new', 'New Studio', ?, ?)`
      )
      .bind(now, now)
      .run()
    await expect(
      test.d1
        .prepare(`UPDATE shops SET brand_id = 'brd_new' WHERE id = 'shp_expand'`)
        .run()
    ).rejects.toThrow(/Shop ownership/)
    await expect(
      test.d1.prepare(`DELETE FROM shops WHERE id = 'shp_expand'`).run()
    ).rejects.toThrow(/requires its Shop/)
    await expect(
      test.d1
        .prepare(
          `DELETE FROM provider_service_eligibility
           WHERE provider_id = 'prv_expand' AND service_id = 'svc_expand'`
        )
        .run()
    ).rejects.toThrow(/eligible/)
  }, 60_000)

  it('resumes bounded appointment backfill idempotently after interruption', async () => {
    const test = await provisionPrevious()
    await insertSoloFixture(test, 5)
    await applyMigrations(test.d1, {
      after: previousMigration,
      through: expandMigration
    })

    expect(await runBackfill(test, { now, limit: 2 })).toEqual({
      processed: 2,
      cursor: 'apt_001',
      complete: false
    })
    expect(await runBackfill(test, { now, limit: 2 })).toEqual({
      processed: 2,
      cursor: 'apt_003',
      complete: false
    })
    expect(await runBackfill(test, { now, limit: 2 })).toEqual({
      processed: 1,
      cursor: 'apt_004',
      complete: true
    })
    expect(await runBackfill(test, { now, limit: 2 })).toEqual({
      processed: 0,
      cursor: 'apt_004',
      complete: true
    })
    // A previous Worker may commit a lexically earlier id during the window.
    await test.d1
      .prepare(
        `INSERT INTO appointments
         (id, merchant_id, provider_id, status, version, starts_at, ends_at, created_at, updated_at)
         VALUES ('apt_000a', 'mer_expand', 'prv_expand', 'scheduled', 1,
                 '2026-08-10T09:00:00.000Z', '2026-08-10T10:00:00.000Z', ?, ?)`
      )
      .bind(now, now)
      .run()
    expect(await runBackfill(test, { now, limit: 2 })).toEqual({
      processed: 0,
      cursor: 'apt_004',
      complete: true
    })

    const counts = await test.d1
      .prepare(
        `SELECT (SELECT count(*) FROM appointments) source,
              (SELECT count(*) FROM appointment_foundations) foundations,
              (SELECT processed_count FROM beesolo_migration_jobs) processed`
      )
      .first<Record<string, number>>()
    expect(counts).toEqual({ source: 6, foundations: 6, processed: 6 })
    await test.d1.prepare(`DELETE FROM appointments WHERE id = 'apt_004'`).run()
    const afterAppointmentDelete = await test.d1
      .prepare(
        `SELECT status, processed_count, source_count
         FROM beesolo_migration_jobs WHERE fact_kind = 'appointment_foundations'`
      )
      .first<{ status: string; processed_count: number; source_count: number }>()
    expect(afterAppointmentDelete).toEqual({
      status: 'complete',
      processed_count: 5,
      source_count: 5
    })
    await expect(
      test.d1
        .prepare(
          `INSERT INTO providers (id, merchant_id, display_name, status, is_default, created_at, updated_at)
       VALUES ('prv_second', 'mer_expand', 'Second', 'active', 0, ?, ?)`
        )
        .bind(now, now)
        .run()
    ).rejects.toThrow(/one active default Owner-Provider/)
  }, 60_000)

  it('records durable pre/post evidence and remains truthful with concurrent runners', async () => {
    const test = await provisionPrevious()
    await insertSoloFixture(test, 4)
    await applyMigrations(test.d1, {
      after: previousMigration,
      through: expandMigration
    })

    const initialEvidence = await test.d1
      .prepare(
        `SELECT phase, row_count FROM beesolo_migration_evidence
         WHERE migration_name = ? AND fact_kind = 'appointment_foundations'
         ORDER BY phase`
      )
      .bind(expandMigration)
      .all<{ phase: string; row_count: number }>()
    expect(initialEvidence.results).toEqual([
      { phase: 'before', row_count: 4 },
      { phase: 'preflight', row_count: 1 }
    ])

    await Promise.all([
      runBackfill(test, { now, limit: 4 }),
      runBackfill(test, { now, limit: 4 })
    ])

    const job = await test.d1
      .prepare(
        `SELECT status, processed_count, source_count
         FROM beesolo_migration_jobs WHERE fact_kind = 'appointment_foundations'`
      )
      .first<{ status: string; processed_count: number; source_count: number }>()
    const afterEvidence = await test.d1
      .prepare(
        `SELECT row_count FROM beesolo_migration_evidence
         WHERE phase = 'after' AND fact_kind = 'appointment_foundations'`
      )
      .first<{ row_count: number }>()
    const origins = await test.d1
      .prepare(`SELECT DISTINCT origin FROM appointment_foundations`)
      .all<{ origin: string }>()

    expect(job).toEqual({ status: 'complete', processed_count: 4, source_count: 4 })
    expect(afterEvidence).toEqual({ row_count: 4 })
    expect(origins.results).toEqual([{ origin: 'merchant_created' }])

    await test.d1
      .prepare(
        `INSERT INTO appointments
         (id, merchant_id, provider_id, status, version, starts_at, ends_at, created_at, updated_at)
         VALUES ('apt_old_worker', 'mer_expand', 'prv_expand', 'scheduled', 1,
                 '2026-09-01T09:00:00.000Z', '2026-09-01T10:00:00.000Z', ?, ?)`
      )
      .bind(now, now)
      .run()
    const lateFoundation = await test.d1
      .prepare(
        `SELECT origin FROM appointment_foundations WHERE appointment_id = 'apt_old_worker'`
      )
      .first<{ origin: string }>()
    expect(lateFoundation).toEqual({ origin: 'merchant_created' })
    const lateJob = await test.d1
      .prepare(
        `SELECT status, processed_count, source_count
         FROM beesolo_migration_jobs WHERE fact_kind = 'appointment_foundations'`
      )
      .first<{ status: string; processed_count: number; source_count: number }>()
    const lateEvidence = await test.d1
      .prepare(
        `SELECT phase, row_count FROM beesolo_migration_evidence
         WHERE id = '20260802120000_beesolo_expand:old-worker:apt_old_worker'`
      )
      .first<{ phase: string; row_count: number }>()
    expect(lateJob).toEqual({ status: 'complete', processed_count: 5, source_count: 5 })
    expect(lateEvidence).toEqual({ phase: 'repair', row_count: 5 })
  }, 60_000)

  it('does not mark a partial backfill complete when a previous Worker inserts', async () => {
    const test = await provisionPrevious()
    await insertSoloFixture(test, 3)
    await applyMigrations(test.d1, {
      after: previousMigration,
      through: expandMigration
    })

    expect(await runBackfill(test, { now, limit: 1 })).toEqual({
      processed: 1,
      cursor: 'apt_000',
      complete: false
    })
    await test.d1
      .prepare(
        `INSERT INTO appointments
         (id, merchant_id, provider_id, status, version, starts_at, ends_at, created_at, updated_at)
         VALUES ('apt_old_overlap', 'mer_expand', 'prv_expand', 'scheduled', 1,
                 '2026-09-02T09:00:00.000Z', '2026-09-02T10:00:00.000Z', ?, ?)`
      )
      .bind(now, now)
      .run()

    const job = await test.d1
      .prepare(
        `SELECT status, processed_count, source_count, completed_at
         FROM beesolo_migration_jobs WHERE fact_kind = 'appointment_foundations'`
      )
      .first<{
        status: string
        processed_count: number
        source_count: number
        completed_at: string | null
      }>()
    expect(job).toEqual({
      status: 'running',
      processed_count: 2,
      source_count: 4,
      completed_at: null
    })
  }, 60_000)
})
