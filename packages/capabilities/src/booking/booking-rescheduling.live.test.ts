import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { layerFromD1 } from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { LiveBookingRescheduling } from './booking-rescheduling-adapter.ts'
import {
  BookingRescheduling,
  type RescheduleReplacement
} from './booking-rescheduling.ts'

let test: TestD1
const now = '2026-07-13T10:00:00.000Z'
const snapshot = JSON.stringify({
  startsAt: '2026-07-14T10:00:00.000Z',
  endsAt: '2026-07-14T11:00:00.000Z',
  providerPreference: { kind: 'specific', providerId: 'prv_old' },
  assignedProvider: { id: 'prv_old', displayName: 'Old Provider' },
  services: [],
  durationMinutes: 60,
  currency: 'USD',
  totalMinor: 5_000,
  merchantTimezone: 'UTC',
  customerDetails: { name: 'Ana', email: 'ana@example.test', phone: null },
  checkoutPath: 'pay_in_person'
})
const replacement = (startsAt = '2026-07-15T12:00:00.000Z'): RescheduleReplacement => ({
  hold: {
    id: `rsh_${startsAt.slice(8, 10)}`,
    providerId: 'prv_new',
    providerDisplayName: 'New Provider',
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 3_600_000).toISOString(),
    expiresAt: '2026-07-13T10:15:00.000Z'
  },
  quote: {
    id: `prq_${startsAt.slice(8, 10)}`,
    version: 2,
    totalMinor: 5_000,
    currency: 'USD',
    acceptedAt: now,
    expiresAt: '2026-07-13T10:15:00.000Z'
  },
  policyAcceptance: {
    policyId: 'pol_checkout',
    policyVersion: 3,
    disclosureSnapshot: 'Current rescheduling policy.',
    acceptedAt: now
  },
  settlement: { kind: 'unchanged', amountMinor: 0, referenceId: null },
  reminderAt: '2026-07-15T10:00:00.000Z'
})

beforeAll(async () => {
  test = await provisionTestD1()
  for (const statement of [
    `INSERT INTO merchants (id, public_name, slug, timezone, currency, plan, created_at, updated_at) VALUES ('mrc_reschedule', 'Reschedule Shop', 'reschedule-shop', 'UTC', 'USD', 'solo', '${now}', '${now}')`,
    `INSERT INTO brands (id, merchant_id, name, created_at, updated_at) VALUES ('brd_reschedule', 'mrc_reschedule', 'Reschedule Shop', '${now}', '${now}')`,
    `INSERT INTO shops (id, brand_id, merchant_id, slug, public_name, timezone, currency, created_at, updated_at) VALUES ('shp_reschedule', 'brd_reschedule', 'mrc_reschedule', 'reschedule', 'Reschedule Shop', 'UTC', 'USD', '${now}', '${now}')`,
    `INSERT INTO providers (id, merchant_id, display_name, status, created_at, updated_at) VALUES ('prv_old', 'mrc_reschedule', 'Old Provider', 'active', '${now}', '${now}')`,
    `INSERT INTO providers (id, merchant_id, display_name, status, created_at, updated_at) VALUES ('prv_new', 'mrc_reschedule', 'New Provider', 'active', '${now}', '${now}')`,
    `INSERT INTO booking_sessions (id, merchant_id, capability_hash, checkout_path, lifecycle, created_at, last_activity_at, idle_expires_at, absolute_expires_at) VALUES ('bsn_reschedule', 'mrc_reschedule', 'booking-hash', 'pay_in_person', 'consumed', '${now}', '${now}', '2026-07-14T12:00:00.000Z', '2026-07-14T13:00:00.000Z')`,
    `INSERT INTO booking_parties (id, booking_session_id, shop_id, lifecycle, currency, locale, version, created_at, updated_at) VALUES ('bpt_reschedule', 'bsn_reschedule', 'shp_reschedule', 'confirmed', 'USD', 'en', 1, '${now}', '${now}')`,
    `INSERT INTO appointments (id, merchant_id, provider_id, booking_party_id, status, version, starts_at, ends_at, snapshot, created_at, updated_at) VALUES ('apt_reschedule', 'mrc_reschedule', 'prv_old', 'bpt_reschedule', 'scheduled', 1, '2026-07-14T10:00:00.000Z', '2026-07-14T11:00:00.000Z', '${snapshot}', '${now}', '${now}')`,
    `INSERT INTO notification_intents (id, shop_id, topic, recipient_json, payload_json, source_type, source_id, source_version, deduplication_key, status, available_at, created_at, updated_at) VALUES ('nti_old_reminder', 'shp_reschedule', 'appointment.reminder', '{}', '{}', 'appointment', 'apt_reschedule', 1, 'reminder:apt_reschedule:1:old', 'pending', '2026-07-14T08:00:00.000Z', '${now}', '${now}')`,
    `INSERT INTO scheduled_work (id, shop_id, kind, source_type, source_id, source_version, payload_json, idempotency_key, status, run_at, attempts, created_at, updated_at) VALUES ('scw_old_reminder', 'shp_reschedule', 'appointment.reminder', 'appointment', 'apt_reschedule', 1, '{}', 'work:reminder:apt_reschedule:1:old', 'pending', '2026-07-14T08:00:00.000Z', 0, '${now}', '${now}')`
  ])
    await test.d1.prepare(statement).run()
}, 60_000)

afterAll(async () => test.dispose())

const run = <A>(effect: Effect.Effect<A, unknown, BookingRescheduling>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(LiveBookingRescheduling.pipe(Layer.provide(layerFromD1(test.d1))))
    )
  )

describe('Live Booking rescheduling', () => {
  it('commits the replacement and reminder-version swap in one D1 batch', async () => {
    const session = await run(
      Effect.flatMap(BookingRescheduling, (service) =>
        service.begin({
          merchantId: 'mrc_reschedule',
          appointmentId: 'apt_reschedule',
          capabilityHash: 'reschedule-capability-one',
          expiresAt: '2026-07-13T10:20:00.000Z',
          now
        })
      )
    )
    await run(
      Effect.flatMap(BookingRescheduling, (service) =>
        service.prepare({
          sessionId: session.id,
          capabilityHash: 'reschedule-capability-one',
          replacement: replacement(),
          now
        })
      )
    )
    const commit = () =>
      run(
        Effect.flatMap(BookingRescheduling, (service) =>
          service.commit({
            merchantId: 'mrc_reschedule',
            sessionId: session.id,
            capabilityHash: 'reschedule-capability-one',
            idempotencyKey: 'reschedule-live-once',
            now
          })
        )
      )
    const result = await commit()
    expect(result).toMatchObject({ fromVersion: 1, toVersion: 2, replayed: false })
    expect((await commit()).replayed).toBe(true)

    const rows = await test.d1.batch([
      test.d1.prepare(
        "SELECT provider_id, starts_at, version, status FROM appointments WHERE id = 'apt_reschedule'"
      ),
      test.d1.prepare(
        "SELECT from_state, to_state, reason_code, facts_json FROM lifecycle_history WHERE aggregate_id = 'apt_reschedule'"
      ),
      test.d1.prepare(
        "SELECT source_version, status, deduplication_key FROM notification_intents WHERE source_id = 'apt_reschedule' ORDER BY source_version"
      ),
      test.d1.prepare(
        "SELECT source_version, status FROM scheduled_work WHERE source_id = 'apt_reschedule' ORDER BY source_version"
      ),
      test.d1.prepare('SELECT * FROM reschedule_commands')
    ])
    expect(rows[0]!.results[0]).toMatchObject({
      provider_id: 'prv_new',
      starts_at: '2026-07-15T12:00:00.000Z',
      version: 2,
      status: 'scheduled'
    })
    expect(rows[1]!.results).toHaveLength(1)
    expect(rows[1]!.results[0]).toMatchObject({
      from_state: 'scheduled',
      to_state: 'scheduled',
      reason_code: 'customer_rescheduled'
    })
    expect(rows[2]!.results).toEqual([
      expect.objectContaining({ source_version: 1, status: 'cancelled' }),
      expect.objectContaining({ source_version: 2, status: 'pending' })
    ])
    expect(rows[3]!.results).toEqual([
      expect.objectContaining({ source_version: 1, status: 'cancelled' }),
      expect.objectContaining({ source_version: 2, status: 'pending' })
    ])
    expect(rows[4]!.results).toHaveLength(1)
  })

  it('rejects a stale replacement session after the winning version is committed', async () => {
    const stale = await run(
      Effect.flatMap(BookingRescheduling, (service) =>
        service.begin({
          merchantId: 'mrc_reschedule',
          appointmentId: 'apt_reschedule',
          capabilityHash: 'reschedule-capability-stale',
          expiresAt: '2026-07-13T10:20:00.000Z',
          now
        })
      )
    )
    await run(
      Effect.flatMap(BookingRescheduling, (service) =>
        service.prepare({
          sessionId: stale.id,
          capabilityHash: 'reschedule-capability-stale',
          replacement: replacement('2026-07-16T12:00:00.000Z'),
          now
        })
      )
    )
    await test.d1
      .prepare("UPDATE appointments SET version = 3 WHERE id = 'apt_reschedule'")
      .run()
    await expect(
      run(
        Effect.flatMap(BookingRescheduling, (service) =>
          service.commit({
            merchantId: 'mrc_reschedule',
            sessionId: stale.id,
            capabilityHash: 'reschedule-capability-stale',
            idempotencyKey: 'reschedule-stale',
            now
          })
        )
      )
    ).rejects.toMatchObject({ code: 'version_conflict' })
    const appointment = await test.d1
      .prepare(
        "SELECT starts_at, version FROM appointments WHERE id = 'apt_reschedule'"
      )
      .first()
    expect(appointment).toMatchObject({
      starts_at: '2026-07-15T12:00:00.000Z',
      version: 3
    })
  })
})
