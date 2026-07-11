import { Effect } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { layerFromD1 } from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import {
  BookingNotificationOutbox,
  LiveBookingNotificationOutbox
} from './booking-notifications.ts'

let test: TestD1
const now = '2026-07-11T10:00:00.000Z'
const snapshot = {
  startsAt: '2026-07-20T10:00:00.000Z',
  endsAt: '2026-07-20T11:00:00.000Z',
  providerPreference: { kind: 'any' },
  assignedProvider: { id: 'prv_notify', displayName: 'Ava' },
  services: [
    {
      id: 'svc_notify',
      role: 'primary',
      name: 'Cut',
      durationMinutes: 60,
      priceMinor: 5000,
      currency: 'USD'
    }
  ],
  durationMinutes: 60,
  currency: 'USD',
  totalMinor: 5000,
  merchantTimezone: 'Europe/Bucharest',
  customerDetails: { name: 'Mia', email: 'mia@example.com', phone: null },
  checkoutPath: 'pay_in_person'
}

const run = <A>(effect: Effect.Effect<A, unknown, BookingNotificationOutbox>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(LiveBookingNotificationOutbox),
      Effect.provide(layerFromD1(test.d1))
    )
  )

beforeAll(async () => {
  test = await provisionTestD1()
  const statements = [
    [
      'INSERT INTO merchants (id, public_name, slug, timezone, currency, plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ['mer_notify', 'Notify', 'notify', 'Europe/Bucharest', 'USD', 'solo', now, now]
    ],
    [
      'INSERT INTO providers (id, merchant_id, display_name, status, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['prv_notify', 'mer_notify', 'Ava', 'active', 1, now, now]
    ],
    [
      'INSERT INTO appointments (id, merchant_id, provider_id, status, starts_at, ends_at, snapshot, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        'apt_notify',
        'mer_notify',
        'prv_notify',
        'scheduled',
        snapshot.startsAt,
        snapshot.endsAt,
        JSON.stringify(snapshot),
        now,
        now
      ]
    ],
    [
      'INSERT INTO confirmation_access (route_id, appointment_id, token_version, signing_key_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ['cnf_notify', 'apt_notify', 1, 'current', '2026-08-20T11:00:00.000Z', now]
    ],
    [
      'INSERT INTO booking_outbox (id, appointment_id, kind, trace_id, created_at) VALUES (?, ?, ?, ?, ?)',
      ['out_notify', 'apt_notify', 'appointment.created', 'trace_notify', now]
    ],
    [
      'INSERT INTO platform_webhook_endpoints (id, merchant_id, url, signing_secret, status, events, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [
        'wh_notify',
        'mer_notify',
        'https://example.com/hook',
        'whsec_test',
        'active',
        JSON.stringify(['appointment.created']),
        now,
        now
      ]
    ]
  ] as const
  for (const [sql, values] of statements)
    await test.d1
      .prepare(sql)
      .bind(...values)
      .run()
})
afterAll(async () => test.dispose())

describe('LiveBookingNotificationOutbox', () => {
  it('atomically claims once, creates one stable PII-free event, and reclaims stale work', async () => {
    const work = await run(
      Effect.flatMap(BookingNotificationOutbox, (store) =>
        store.claim('out_notify', now)
      )
    )
    expect(work?.snapshot.customerDetails.email).toBe('mia@example.com')
    await expect(
      run(
        Effect.flatMap(BookingNotificationOutbox, (store) =>
          store.claim('out_notify', now)
        )
      )
    ).resolves.toBeNull()
    const event = await run(
      Effect.flatMap(BookingNotificationOutbox, (store) => store.ensureEvent(work!))
    )
    const duplicate = await run(
      Effect.flatMap(BookingNotificationOutbox, (store) => store.ensureEvent(work!))
    )
    expect(duplicate).toEqual(event)
    expect(event.id).toMatch(/^evt_/)
    expect(event.rawBody).not.toContain('mia@example.com')
    expect(event.rawBody).not.toContain('Cut')
    expect(
      await run(
        Effect.flatMap(BookingNotificationOutbox, (store) =>
          store.recoverable('2026-07-11T10:02:00.000Z')
        )
      )
    ).toContain('out_notify')
  })

  it('persists sanitized attempts and completion before completed work becomes a no-op', async () => {
    await run(
      Effect.flatMap(BookingNotificationOutbox, (store) =>
        store.recordAttempt({
          id: 'dlv_notify',
          endpointId: 'wh_notify',
          eventId: 'evt_notify',
          status: 'delivered',
          failureCode: null,
          attemptNumber: 1,
          responseStatus: 204,
          durationMs: 12,
          attemptedAt: now,
          nextAttemptAt: null
        })
      )
    )
    await run(
      Effect.flatMap(BookingNotificationOutbox, (store) =>
        store.finish('out_notify', 'completed', now)
      )
    )
    await expect(
      run(
        Effect.flatMap(BookingNotificationOutbox, (store) =>
          store.claim('out_notify', '2026-07-11T10:05:00.000Z')
        )
      )
    ).resolves.toBeNull()
    const row = await test.d1
      .prepare(
        'SELECT status, response_status FROM platform_webhook_deliveries WHERE id = ?'
      )
      .bind('dlv_notify')
      .first()
    expect(row).toEqual(
      expect.objectContaining({ status: 'delivered', response_status: 204 })
    )
  })
})
