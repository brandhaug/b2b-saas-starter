import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { layerFromD1 } from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { LiveBookingRescheduling } from './booking-rescheduling-adapter.ts'
import {
  BookingRescheduling,
  type RescheduleSession,
  type RescheduleReplacement
} from './booking-rescheduling.ts'

let test: TestD1
const now = '2026-07-13T10:00:00.000Z'
const snapshot = JSON.stringify({
  startsAt: '2026-07-14T10:00:00.000Z',
  endsAt: '2026-07-14T11:00:00.000Z',
  providerPreference: { kind: 'specific', providerId: 'prv_old' },
  assignedProvider: { id: 'prv_old', displayName: 'Old Provider' },
  services: [
    {
      id: 'svc_reschedule',
      role: 'primary',
      name: 'Cut',
      durationMinutes: 60,
      priceMinor: 5_000,
      currency: 'USD'
    }
  ],
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
    `INSERT INTO services (id, merchant_id, name, price_minor, currency, duration_minutes, status, created_at, updated_at) VALUES ('svc_reschedule', 'mrc_reschedule', 'Cut', 5000, 'USD', 60, 'active', '${now}', '${now}')`,
    `INSERT INTO providers (id, merchant_id, display_name, status, created_at, updated_at) VALUES ('prv_old', 'mrc_reschedule', 'Old Provider', 'active', '${now}', '${now}')`,
    `INSERT INTO providers (id, merchant_id, display_name, status, created_at, updated_at) VALUES ('prv_new', 'mrc_reschedule', 'New Provider', 'active', '${now}', '${now}')`,
    `INSERT INTO booking_sessions (id, merchant_id, capability_hash, checkout_path, lifecycle, created_at, last_activity_at, idle_expires_at, absolute_expires_at) VALUES ('bsn_reschedule', 'mrc_reschedule', 'booking-hash', 'pay_in_person', 'consumed', '${now}', '${now}', '2026-07-14T12:00:00.000Z', '2026-07-14T13:00:00.000Z')`,
    `INSERT INTO booking_parties (id, booking_session_id, shop_id, lifecycle, currency, locale, version, created_at, updated_at) VALUES ('bpt_reschedule', 'bsn_reschedule', 'shp_reschedule', 'confirmed', 'USD', 'en', 1, '${now}', '${now}')`,
    `INSERT INTO settlement_allocations (id, booking_party_id, tender, reference_id, amount_minor, currency, created_at) VALUES ('sal_reschedule', 'bpt_reschedule', 'external_payment', 'pay_original', 5000, 'USD', '${now}')`,
    `INSERT INTO checkout_policies (id, shop_id, scope, scope_id, kind, version, disclosure, effective_at, created_at) VALUES ('pol_checkout', 'shp_reschedule', 'shop', 'shp_reschedule', 'checkout', 3, 'Current rescheduling policy.', '${now}', '${now}')`,
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

const persistReplacementFacts = async (
  session: RescheduleSession,
  facts: RescheduleReplacement
) => {
  const quote = JSON.stringify({
    startsAt: facts.hold.startsAt,
    endsAt: facts.hold.endsAt,
    providerPreference: { kind: 'specific', providerId: facts.hold.providerId },
    assignedProvider: {
      id: facts.hold.providerId,
      displayName: facts.hold.providerDisplayName
    },
    services: [],
    durationMinutes: 60,
    currency: facts.quote.currency,
    totalMinor: facts.quote.totalMinor
  })
  await test.d1.batch([
    test.d1
      .prepare(
        `INSERT INTO time_slot_holds (id, merchant_id, booking_session_id, provider_id, starts_at, ends_at, created_at, expires_at, quote)
         VALUES (?, 'mrc_reschedule', ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        facts.hold.id,
        session.bookingSessionId,
        facts.hold.providerId,
        facts.hold.startsAt,
        facts.hold.endsAt,
        now,
        facts.hold.expiresAt,
        quote
      ),
    test.d1
      .prepare(
        `INSERT INTO pricing_quotes (id, booking_party_id, version, currency, subtotal_minor, adjustment_minor, tip_minor, total_minor, facts_json, accepted_at, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, 0, 0, ?, '{}', NULL, ?, ?)`
      )
      .bind(
        facts.quote.id,
        session.bookingPartyId,
        facts.quote.version,
        facts.quote.currency,
        facts.quote.totalMinor,
        facts.quote.totalMinor,
        facts.quote.expiresAt,
        now
      ),
    test.d1
      .prepare(
        `INSERT INTO pricing_quote_acceptances (pricing_quote_id, booking_party_id, party_version, accepted_at, created_at)
         VALUES (?, ?, 1, ?, ?)`
      )
      .bind(facts.quote.id, session.bookingPartyId, facts.quote.acceptedAt, now),
    test.d1
      .prepare(
        `INSERT INTO policy_acceptances (id, booking_party_id, checkout_policy_id, disclosure_snapshot, accepted_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(
        `pac_${session.id}`,
        session.bookingPartyId,
        facts.policyAcceptance.policyId,
        facts.policyAcceptance.disclosureSnapshot,
        facts.policyAcceptance.acceptedAt
      )
  ])
}

describe('Live Booking rescheduling', () => {
  it('uses the authoritative quote acceptance row during replacement preparation', async () => {
    const facts = replacement('2026-07-19T12:00:00.000Z')
    const session = await run(
      Effect.flatMap(BookingRescheduling, (service) =>
        service.begin({
          merchantId: 'mrc_reschedule',
          appointmentId: 'apt_reschedule',
          capabilityHash: 'reschedule-acceptance-row',
          expiresAt: '2026-07-13T10:20:00.000Z',
          now
        })
      )
    )
    await persistReplacementFacts(session, facts)

    const prepared = await run(
      Effect.flatMap(BookingRescheduling, (service) =>
        service.prepare({
          sessionId: session.id,
          capabilityHash: 'reschedule-acceptance-row',
          replacement: facts,
          now
        })
      )
    )

    expect(prepared.replacement?.quote.acceptedAt).toBe(facts.quote.acceptedAt)
  })

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
    const selection = await test.d1
      .prepare(
        `SELECT p.active_request_id, r.provider_preference, r.provider_id, r.primary_service_id
         FROM booking_parties p
         JOIN booking_requests r ON r.id = p.active_request_id
         WHERE p.id = ?`
      )
      .bind(session.bookingPartyId)
      .all()
    expect(selection.results[0]).toMatchObject({
      provider_preference: 'specific',
      provider_id: 'prv_old',
      primary_service_id: 'svc_reschedule'
    })
    expect(selection.results[0]?.active_request_id).toMatch(/^brq_/)
    await persistReplacementFacts(session, replacement())
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
    await persistReplacementFacts(stale, replacement('2026-07-16T12:00:00.000Z'))
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

  it('rejects caller-described replacement facts that have no durable records', async () => {
    const session = await run(
      Effect.flatMap(BookingRescheduling, (service) =>
        service.begin({
          merchantId: 'mrc_reschedule',
          appointmentId: 'apt_reschedule',
          capabilityHash: 'reschedule-capability-fabricated',
          expiresAt: '2026-07-13T10:20:00.000Z',
          now
        })
      )
    )
    await expect(
      run(
        Effect.flatMap(BookingRescheduling, (service) =>
          service.prepare({
            sessionId: session.id,
            capabilityHash: 'reschedule-capability-fabricated',
            replacement: replacement('2026-07-17T12:00:00.000Z'),
            now
          })
        )
      )
    ).rejects.toMatchObject({ code: 'replacement_not_ready' })
  })

  it('rejects a price increase without a captured replacement-party Payment', async () => {
    const session = await run(
      Effect.flatMap(BookingRescheduling, (service) =>
        service.begin({
          merchantId: 'mrc_reschedule',
          appointmentId: 'apt_reschedule',
          capabilityHash: 'reschedule-capability-unsettled',
          expiresAt: '2026-07-13T10:20:00.000Z',
          now
        })
      )
    )
    const base = replacement('2026-07-18T12:00:00.000Z')
    const facts: RescheduleReplacement = {
      ...base,
      quote: { ...base.quote, totalMinor: 6_000 },
      settlement: {
        kind: 'additional_collection',
        amountMinor: 1_000,
        referenceId: 'pay_fabricated'
      }
    }
    await persistReplacementFacts(session, facts)
    await expect(
      run(
        Effect.flatMap(BookingRescheduling, (service) =>
          service.prepare({
            sessionId: session.id,
            capabilityHash: 'reschedule-capability-unsettled',
            replacement: facts,
            now
          })
        )
      )
    ).rejects.toMatchObject({ code: 'settlement_mismatch' })
  })

  it('atomically creates the refund obligation for a price decrease', async () => {
    const session = await run(
      Effect.flatMap(BookingRescheduling, (service) =>
        service.begin({
          merchantId: 'mrc_reschedule',
          appointmentId: 'apt_reschedule',
          capabilityHash: 'reschedule-capability-refund',
          expiresAt: '2026-07-13T10:20:00.000Z',
          now
        })
      )
    )
    const base = replacement('2026-07-18T12:00:00.000Z')
    const facts: RescheduleReplacement = {
      ...base,
      hold: { ...base.hold, id: 'hld_reschedule_refund' },
      quote: { ...base.quote, id: 'prq_reschedule_refund', totalMinor: 4_000 },
      settlement: {
        kind: 'refund',
        amountMinor: 1_000,
        referenceId: 'rfo_reschedule_price_drop'
      }
    }
    await persistReplacementFacts(session, facts)
    await run(
      Effect.flatMap(BookingRescheduling, (service) =>
        service.prepare({
          sessionId: session.id,
          capabilityHash: 'reschedule-capability-refund',
          replacement: facts,
          now
        })
      )
    )
    await run(
      Effect.flatMap(BookingRescheduling, (service) =>
        service.commit({
          merchantId: 'mrc_reschedule',
          sessionId: session.id,
          capabilityHash: 'reschedule-capability-refund',
          idempotencyKey: 'reschedule-refund-once',
          now
        })
      )
    )

    expect(
      await test.d1
        .prepare(
          "SELECT appointment_id, amount_minor, currency, status FROM refund_obligations WHERE id = 'rfo_reschedule_price_drop'"
        )
        .first()
    ).toMatchObject({
      appointment_id: 'apt_reschedule',
      amount_minor: 1_000,
      currency: 'USD',
      status: 'pending'
    })
    expect(
      await test.d1
        .prepare(
          "SELECT tender, reference_id, amount_minor FROM refund_obligation_allocations WHERE refund_obligation_id = 'rfo_reschedule_price_drop'"
        )
        .first()
    ).toMatchObject({
      tender: 'external_payment',
      reference_id: 'pay_original',
      amount_minor: 1_000
    })
  })
})
