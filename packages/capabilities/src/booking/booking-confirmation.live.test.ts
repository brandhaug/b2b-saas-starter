import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  appointments,
  bookingOutbox,
  bookingSessions,
  confirmationAccess,
  Database,
  layerFromD1,
  merchants,
  providers,
  timeSlotHolds
} from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import {
  BookingConfirmation,
  type ConfirmationSigningKeyring,
  deriveConfirmationToken,
  LiveBookingConfirmation,
  verifyConfirmationToken
} from './booking-confirmation.ts'
import type { BookingSession } from './booking-sessions.ts'

let test: TestD1
const now = '2026-07-10T09:30:00.000Z'
const keyring = {
  currentKeyId: 'current',
  keys: { current: 'test-current-key', old: 'test-old-key' }
}
const quote = {
  startsAt: '2026-07-13T09:00:00.000Z',
  endsAt: '2026-07-13T10:30:00.000Z',
  providerPreference: { kind: 'any' as const },
  assignedProvider: { id: 'prv_confirm', displayName: 'Ava' },
  services: [
    {
      id: 'svc_primary',
      role: 'primary' as const,
      name: 'Cut',
      durationMinutes: 60,
      priceMinor: 5000,
      currency: 'USD'
    },
    {
      id: 'svc_extra',
      role: 'additional' as const,
      name: 'Detail',
      durationMinutes: 30,
      priceMinor: 2500,
      currency: 'USD'
    }
  ],
  durationMinutes: 90,
  currency: 'USD',
  totalMinor: 7500
}
const session = (
  id: string,
  lifecycle: 'active' | 'consumed' = 'active'
): BookingSession => ({
  id,
  merchantSlug: 'confirm-live',
  checkoutPath: 'pay_in_person',
  lifecycle,
  createdAt: now,
  lastActivityAt: now,
  idleExpiresAt: '2026-07-10T10:00:00.000Z',
  absoluteExpiresAt: '2026-07-10T11:30:00.000Z'
})

const seedSession = (id: string) =>
  Effect.gen(function* () {
    const db = yield* Database
    yield* db.insert(bookingSessions).values({
      id,
      merchantId: 'mer_confirm',
      capabilityHash: id.padEnd(64, '0'),
      lifecycle: 'active',
      customerName: 'Mia',
      customerEmail: 'mia@example.com',
      customerPhone: '+1 555',
      providerPreference: 'any',
      primaryServiceId: null,
      createdAt: now,
      lastActivityAt: now,
      idleExpiresAt: '2026-07-10T10:00:00.000Z',
      absoluteExpiresAt: '2026-07-10T11:30:00.000Z'
    })
    yield* db.insert(timeSlotHolds).values({
      id: `hld_${id}`,
      merchantId: 'mer_confirm',
      bookingSessionId: id,
      providerId: 'prv_confirm',
      startsAt: quote.startsAt,
      endsAt: quote.endsAt,
      createdAt: now,
      expiresAt: '2026-07-10T09:40:00.000Z',
      quote
    })
  })

beforeAll(async () => {
  test = await provisionTestD1()
  await Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const db = yield* Database
        yield* db.insert(merchants).values({
          id: 'mer_confirm',
          publicName: 'Confirm Live',
          slug: 'confirm-live',
          timezone: 'America/New_York',
          currency: 'USD',
          plan: 'solo',
          createdAt: now,
          updatedAt: now
        })
        yield* db.insert(providers).values({
          id: 'prv_confirm',
          merchantId: 'mer_confirm',
          displayName: 'Ava',
          status: 'active',
          isDefault: true,
          createdAt: now,
          updatedAt: now
        })
        yield* seedSession('bsn_confirm')
        yield* seedSession('bsn_rollback')
        yield* seedSession('bsn_competing')
      }),
      layerFromD1(test.d1)
    )
  )
}, 60_000)

afterAll(async () => test.dispose())

describe('Live Booking Confirmation', () => {
  const layer = () =>
    LiveBookingConfirmation(keyring).pipe(Layer.provide(layerFromD1(test.d1)))
  const confirm = (id: string, lifecycle: 'active' | 'consumed' = 'active') =>
    Effect.runPromise(
      Effect.provide(
        Effect.flatMap(BookingConfirmation, (service) =>
          service.confirm(session(id, lifecycle), { now, traceId: 'trace_confirm' })
        ),
        layer()
      )
    )

  it('atomically snapshots, reduces, persists access/outbox, and replays exactly once', async () => {
    const first = await confirm('bsn_confirm')
    const replay = await confirm('bsn_confirm', 'consumed')
    expect(replay).toEqual({ ...first, replayed: true })
    expect(first.appointment.snapshot).toEqual({
      ...quote,
      merchantTimezone: 'America/New_York',
      customerDetails: { name: 'Mia', email: 'mia@example.com', phone: '+1 555' },
      checkoutPath: 'pay_in_person'
    })
    expect(first.access.token).toBe(
      await deriveConfirmationToken(
        {
          routeId: first.access.routeId,
          tokenVersion: 1,
          signingKeyId: 'current',
          expiresAt: first.access.expiresAt
        },
        keyring
      )
    )

    const stored = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const db = yield* Database
          return {
            sessions: yield* db.select().from(bookingSessions),
            holds: yield* db.select().from(timeSlotHolds),
            appointments: yield* db.select().from(appointments),
            access: yield* db.select().from(confirmationAccess),
            outbox: yield* db.select().from(bookingOutbox)
          }
        }),
        layerFromD1(test.d1)
      )
    )
    const terminal = stored.sessions.find((row) => row.id === 'bsn_confirm')!
    expect(terminal).toMatchObject({
      lifecycle: 'consumed',
      customerName: null,
      customerEmail: null,
      customerPhone: null,
      providerPreference: null,
      providerId: null,
      primaryServiceId: null
    })
    expect(stored.holds.some((row) => row.bookingSessionId === 'bsn_confirm')).toBe(
      false
    )
    expect(
      stored.appointments.filter((row) => row.bookingSessionId === 'bsn_confirm')
    ).toHaveLength(1)
    expect(stored.access).toHaveLength(1)
    expect(stored.outbox).toEqual([
      expect.objectContaining({
        id: first.outboxId,
        traceId: 'trace_confirm',
        kind: 'appointment.created'
      })
    ])
    expect(JSON.stringify(stored.outbox)).not.toContain(first.access.token)
  })

  it('rolls the entire transaction back when an access write fails', async () => {
    await test.d1
      .prepare(
        "CREATE TRIGGER reject_confirmation BEFORE INSERT ON confirmation_access BEGIN SELECT RAISE(ABORT, 'forced rollback'); END"
      )
      .run()
    await expect(confirm('bsn_rollback')).rejects.toMatchObject({
      _tag: 'BookingConfirmationRejected',
      reason: 'conflict'
    })
    await test.d1.prepare('DROP TRIGGER reject_confirmation').run()
    const counts = await test.d1
      .prepare(
        "SELECT (SELECT count(*) FROM appointments WHERE booking_session_id = 'bsn_rollback') appointments, (SELECT count(*) FROM booking_outbox) outbox, (SELECT count(*) FROM time_slot_holds WHERE booking_session_id = 'bsn_rollback') holds"
      )
      .first<{ appointments: number; outbox: number; holds: number }>()
    expect(counts).toEqual({ appointments: 0, outbox: 1, holds: 1 })
  })

  it('converges competing confirmations on one Appointment and outbox item', async () => {
    const results = await Promise.all([
      confirm('bsn_competing'),
      confirm('bsn_competing')
    ])
    expect(results[0]!.appointment.id).toBe(results[1]!.appointment.id)
    const rows = await test.d1
      .prepare(
        "SELECT count(*) count FROM appointments WHERE booking_session_id = 'bsn_competing'"
      )
      .first<{ count: number }>()
    expect(rows?.count).toBe(1)
  })

  it('verifies retained keys and rejects expired, revoked, and wrong-version access', async () => {
    const metadata = {
      routeId: 'cnf_rotated',
      tokenVersion: 2,
      signingKeyId: 'old',
      expiresAt: '2026-08-10T09:30:00.000Z'
    }
    const token = await deriveConfirmationToken(metadata, keyring)
    await expect(verifyConfirmationToken(metadata, token, keyring, now)).resolves.toBe(
      true
    )
    await expect(
      verifyConfirmationToken({ ...metadata, revokedAt: now }, token, keyring, now)
    ).resolves.toBe(false)
    await expect(
      verifyConfirmationToken({ ...metadata, expiresAt: now }, token, keyring, now)
    ).resolves.toBe(false)
    await expect(
      verifyConfirmationToken({ ...metadata, tokenVersion: 3 }, token, keyring, now)
    ).resolves.toBe(false)
  })

  it('reads only the matching Appointment snapshot and revalidates expiry, revocation, status, and retained keys', async () => {
    const confirmed = await confirm('bsn_confirm', 'consumed')
    const read = (
      token: string,
      at = now,
      keyringOverride: ConfirmationSigningKeyring = keyring
    ) =>
      Effect.runPromise(
        Effect.provide(
          Effect.flatMap(BookingConfirmation, (service) =>
            service.read({ routeId: confirmed.access.routeId, token, now: at })
          ),
          LiveBookingConfirmation(keyringOverride).pipe(
            Layer.provide(layerFromD1(test.d1))
          )
        )
      )

    await expect(read(confirmed.access.token)).resolves.toMatchObject({
      kind: 'found',
      confirmation: {
        routeId: confirmed.access.routeId,
        status: 'scheduled',
        merchant: { publicName: 'Confirm Live' },
        snapshot: {
          customerDetails: { email: 'mia@example.com' },
          checkoutPath: 'pay_in_person'
        }
      }
    })
    await expect(read('0'.repeat(64))).resolves.toEqual({ kind: 'not_found' })

    await test.d1
      .prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?")
      .bind(confirmed.appointment.id)
      .run()
    await expect(read(confirmed.access.token)).resolves.toMatchObject({
      kind: 'found',
      confirmation: { status: 'cancelled' }
    })

    await expect(
      read(confirmed.access.token, confirmed.access.expiresAt)
    ).resolves.toEqual({ kind: 'expired' })
    await test.d1
      .prepare(
        'UPDATE confirmation_access SET token_version = token_version + 1 WHERE route_id = ?'
      )
      .bind(confirmed.access.routeId)
      .run()
    await expect(read(confirmed.access.token)).resolves.toEqual({ kind: 'not_found' })

    await test.d1
      .prepare('UPDATE confirmation_access SET token_version = 1 WHERE route_id = ?')
      .bind(confirmed.access.routeId)
      .run()
    await expect(
      read(confirmed.access.token, now, {
        currentKeyId: 'next',
        keys: { ...keyring.keys, next: 'test-next-key' }
      })
    ).resolves.toMatchObject({ kind: 'found' })
    await expect(
      read(confirmed.access.token, now, {
        currentKeyId: 'next',
        keys: { next: 'test-next-key' }
      })
    ).resolves.toEqual({ kind: 'not_found' })
  })
})
