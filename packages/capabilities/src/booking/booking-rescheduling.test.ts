import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  BookingRescheduling,
  SeedBookingRescheduling,
  emptySeedBookingReschedulingStore,
  type ReschedulableAppointment,
  type RescheduleReplacement
} from './booking-rescheduling.ts'

const now = '2026-07-13T10:00:00.000Z'
const appointment = (
  overrides: Partial<ReschedulableAppointment> = {}
): ReschedulableAppointment => ({
  id: 'apt_one',
  merchantId: 'mrc_one',
  shopId: 'shp_one',
  status: 'scheduled',
  version: 1,
  providerId: 'prv_old',
  startsAt: '2026-07-14T10:00:00.000Z',
  endsAt: '2026-07-14T11:00:00.000Z',
  snapshot: {
    totalMinor: 5_000,
    currency: 'USD',
    assignedProvider: { id: 'prv_old', displayName: 'Old Provider' },
    startsAt: '2026-07-14T10:00:00.000Z',
    endsAt: '2026-07-14T11:00:00.000Z'
  },
  ...overrides
})
const replacement = (
  overrides: Partial<RescheduleReplacement> = {}
): RescheduleReplacement => ({
  hold: {
    id: 'rsh_one',
    providerId: 'prv_new',
    providerDisplayName: 'New Provider',
    startsAt: '2026-07-15T12:00:00.000Z',
    endsAt: '2026-07-15T13:00:00.000Z',
    expiresAt: '2026-07-13T10:15:00.000Z'
  },
  quote: {
    id: 'prq_two',
    version: 2,
    totalMinor: 5_000,
    currency: 'USD',
    acceptedAt: now,
    expiresAt: '2026-07-13T10:15:00.000Z'
  },
  policyAcceptance: {
    policyId: 'pol_checkout',
    policyVersion: 3,
    disclosureSnapshot: 'Changes are subject to the current policy.',
    acceptedAt: now
  },
  settlement: { kind: 'unchanged', amountMinor: 0, referenceId: null },
  reminderAt: '2026-07-15T10:00:00.000Z',
  ...overrides
})

const run = <A, E>(
  store: ReturnType<typeof emptySeedBookingReschedulingStore>,
  effect: Effect.Effect<A, E, BookingRescheduling>
) => Effect.runPromise(effect.pipe(Effect.provide(SeedBookingRescheduling(store))))

const begin = (
  store: ReturnType<typeof emptySeedBookingReschedulingStore>,
  appointmentId = 'apt_one'
) =>
  run(
    store,
    Effect.flatMap(BookingRescheduling, (service) =>
      service.begin({
        merchantId: 'mrc_one',
        appointmentId,
        capabilityHash: 'capability-hash',
        expiresAt: '2026-07-13T10:20:00.000Z',
        now
      })
    )
  )

describe('Booking rescheduling contract', () => {
  it('preserves the original Appointment while replacement work is incomplete, failed, or expired', async () => {
    const original = appointment()
    const conflict = appointment({
      id: 'apt_conflict',
      providerId: 'prv_new',
      startsAt: '2026-07-15T12:30:00.000Z',
      endsAt: '2026-07-15T13:30:00.000Z'
    })
    const store = emptySeedBookingReschedulingStore([original, conflict])
    const session = await begin(store)

    await expect(
      run(
        store,
        Effect.flatMap(BookingRescheduling, (service) =>
          service.prepare({
            sessionId: session.id,
            capabilityHash: 'capability-hash',
            replacement: replacement(),
            now
          })
        )
      )
    ).rejects.toMatchObject({ code: 'slot_conflict' })
    expect(store.appointments.get(original.id)).toEqual(original)

    const expiredStore = emptySeedBookingReschedulingStore([original])
    const expiredSession = await begin(expiredStore)
    await expect(
      run(
        expiredStore,
        Effect.flatMap(BookingRescheduling, (service) =>
          service.commit({
            merchantId: 'mrc_one',
            sessionId: expiredSession.id,
            capabilityHash: 'capability-hash',
            idempotencyKey: 'reschedule-expired',
            now: '2026-07-13T10:21:00.000Z'
          })
        )
      )
    ).rejects.toMatchObject({ code: 'session_expired' })
    expect(expiredStore.appointments.get(original.id)).toEqual(original)
  })

  it('atomically swaps time, Provider, accepted price facts, and immutable history', async () => {
    const original = appointment()
    const store = emptySeedBookingReschedulingStore([original])
    const session = await begin(store)
    await run(
      store,
      Effect.flatMap(BookingRescheduling, (service) =>
        service.prepare({
          sessionId: session.id,
          capabilityHash: 'capability-hash',
          replacement: replacement(),
          now
        })
      )
    )
    const result = await run(
      store,
      Effect.flatMap(BookingRescheduling, (service) =>
        service.commit({
          merchantId: 'mrc_one',
          sessionId: session.id,
          capabilityHash: 'capability-hash',
          idempotencyKey: 'reschedule-once',
          now
        })
      )
    )

    expect(result).toMatchObject({ replayed: false, fromVersion: 1, toVersion: 2 })
    expect(result.appointment).toMatchObject({
      status: 'scheduled',
      version: 2,
      providerId: 'prv_new',
      startsAt: '2026-07-15T12:00:00.000Z',
      endsAt: '2026-07-15T13:00:00.000Z',
      snapshot: {
        totalMinor: 5_000,
        currency: 'USD',
        acceptedRescheduleQuote: { id: 'prq_two', version: 2 },
        acceptedReschedulePolicy: { id: 'pol_checkout', version: 3 }
      }
    })
    expect(store.history).toEqual([
      expect.objectContaining({
        appointmentId: original.id,
        fromVersion: 1,
        toVersion: 2,
        prior: expect.objectContaining({ providerId: 'prv_old' }),
        replacement: expect.objectContaining({ providerId: 'prv_new' })
      })
    ])
  })

  it('requires explicit accepted settlement consequences for material price changes', async () => {
    const store = emptySeedBookingReschedulingStore([appointment()])
    const session = await begin(store)
    await expect(
      run(
        store,
        Effect.flatMap(BookingRescheduling, (service) =>
          service.prepare({
            sessionId: session.id,
            capabilityHash: 'capability-hash',
            replacement: replacement({
              quote: { ...replacement().quote, totalMinor: 4_000 }
            }),
            now
          })
        )
      )
    ).rejects.toMatchObject({ code: 'settlement_mismatch' })

    await expect(
      run(
        store,
        Effect.flatMap(BookingRescheduling, (service) =>
          service.prepare({
            sessionId: session.id,
            capabilityHash: 'capability-hash',
            replacement: replacement({
              quote: { ...replacement().quote, totalMinor: 4_000 },
              settlement: {
                kind: 'refund',
                amountMinor: 1_000,
                referenceId: 'rfo_reschedule'
              }
            }),
            now
          })
        )
      )
    ).resolves.toMatchObject({ replacement: { settlement: { kind: 'refund' } } })
  })

  it('invalidates old pending reminders and creates one reminder bound to the new version', async () => {
    const store = emptySeedBookingReschedulingStore([appointment()], {
      notificationIntents: [
        {
          id: 'nti_old',
          appointmentId: 'apt_one',
          appointmentVersion: 1,
          status: 'pending',
          availableAt: '2026-07-14T08:00:00.000Z',
          deduplicationKey: 'reminder:apt_one:1:2026-07-14T08:00:00.000Z'
        },
        {
          id: 'nti_delivered',
          appointmentId: 'apt_one',
          appointmentVersion: 1,
          status: 'delivered',
          availableAt: '2026-07-13T08:00:00.000Z',
          deduplicationKey: 'reminder:apt_one:1:2026-07-13T08:00:00.000Z'
        }
      ]
    })
    const session = await begin(store)
    await run(
      store,
      Effect.flatMap(BookingRescheduling, (service) =>
        service.prepare({
          sessionId: session.id,
          capabilityHash: 'capability-hash',
          replacement: replacement(),
          now
        })
      )
    )
    const commit = () =>
      run(
        store,
        Effect.flatMap(BookingRescheduling, (service) =>
          service.commit({
            merchantId: 'mrc_one',
            sessionId: session.id,
            capabilityHash: 'capability-hash',
            idempotencyKey: 'reschedule-reminder',
            now
          })
        )
      )

    const result = await commit()
    expect(store.notificationIntents).toEqual([
      expect.objectContaining({ id: 'nti_old', status: 'cancelled' }),
      expect.objectContaining({ id: 'nti_delivered', status: 'delivered' }),
      expect.objectContaining({
        appointmentId: 'apt_one',
        appointmentVersion: 2,
        status: 'pending',
        availableAt: '2026-07-15T10:00:00.000Z'
      })
    ])
    expect(await commit()).toEqual({ ...result, replayed: true })
    expect(store.notificationIntents).toHaveLength(3)
  })

  it('deduplicates commands and rejects a stale concurrent replacement without changing the winner', async () => {
    const store = emptySeedBookingReschedulingStore([appointment()])
    const first = await begin(store)
    const second = await run(
      store,
      Effect.flatMap(BookingRescheduling, (service) =>
        service.begin({
          merchantId: 'mrc_one',
          appointmentId: 'apt_one',
          capabilityHash: 'second-capability-hash',
          expiresAt: '2026-07-13T10:20:00.000Z',
          now
        })
      )
    )
    for (const [session, capabilityHash, startsAt] of [
      [first, 'capability-hash', '2026-07-15T12:00:00.000Z'],
      [second, 'second-capability-hash', '2026-07-16T12:00:00.000Z']
    ] as const)
      await run(
        store,
        Effect.flatMap(BookingRescheduling, (service) =>
          service.prepare({
            sessionId: session.id,
            capabilityHash,
            replacement: replacement({
              hold: {
                ...replacement().hold,
                id: `rsh_${session.id}`,
                startsAt,
                endsAt: new Date(Date.parse(startsAt) + 3_600_000).toISOString()
              }
            }),
            now
          })
        )
      )

    await run(
      store,
      Effect.flatMap(BookingRescheduling, (service) =>
        service.commit({
          merchantId: 'mrc_one',
          sessionId: first.id,
          capabilityHash: 'capability-hash',
          idempotencyKey: 'winner',
          now
        })
      )
    )
    await expect(
      run(
        store,
        Effect.flatMap(BookingRescheduling, (service) =>
          service.commit({
            merchantId: 'mrc_one',
            sessionId: second.id,
            capabilityHash: 'second-capability-hash',
            idempotencyKey: 'loser',
            now
          })
        )
      )
    ).rejects.toMatchObject({ code: 'version_conflict' })
    expect(store.appointments.get('apt_one')).toMatchObject({
      version: 2,
      startsAt: '2026-07-15T12:00:00.000Z'
    })
    expect(store.history).toHaveLength(1)
  })
})
