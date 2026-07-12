import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { buildSeedBookingScenario } from '../merchant-catalog/merchant-onboarding.ts'
import {
  BookingSelection,
  emptySeedBookingSelectionStore,
  SeedBookingSelection,
  seedBookingSelectionEligibilityKey
} from './booking-selection.ts'
import type { BookingSession } from './booking-sessions.ts'
import {
  BookingScheduling,
  emptySeedBookingSchedulingStore,
  SeedBookingScheduling
} from './booking-scheduling.ts'

const now = '2026-07-10T09:30:00.000Z'
const session = (id: string): BookingSession => ({
  id,
  merchantSlug: 'mara-booking-studio',
  checkoutPath: 'pay_in_person',
  lifecycle: 'active',
  createdAt: now,
  lastActivityAt: now,
  idleExpiresAt: '2026-07-10T10:00:00.000Z',
  absoluteExpiresAt: '2026-07-10T11:30:00.000Z'
})

const fixture = async () => {
  const scenario = buildSeedBookingScenario(now)
  const selections = emptySeedBookingSelectionStore({
    merchants: [
      {
        id: scenario.merchant.id,
        slug: scenario.merchant.slug,
        presentation: scenario.merchant.plan
      }
    ],
    providers: scenario.providers,
    services: scenario.services,
    eligibility: scenario.eligibility.map(seedBookingSelectionEligibilityKey)
  })
  const selectionLayer = SeedBookingSelection(selections)
  const select = <A, E>(effect: Effect.Effect<A, E, BookingSelection>) =>
    Effect.runPromise(Effect.provide(effect, selectionLayer))
  for (const bookingSession of [session('bsn_one'), session('bsn_two')]) {
    await select(
      Effect.flatMap(BookingSelection, (selection) =>
        selection.chooseProvider(bookingSession, { kind: 'any' }, 1)
      )
    )
    await select(
      Effect.flatMap(BookingSelection, (selection) =>
        selection.chooseServices(
          bookingSession,
          {
            primaryServiceId: 'svc_seed_signature_cut',
            additionalServiceIds: ['svc_seed_beard_detail']
          },
          2
        )
      )
    )
  }
  const store = emptySeedBookingSchedulingStore(scenario, selections)
  const layer = SeedBookingScheduling(store)
  const run = <A, E>(effect: Effect.Effect<A, E, BookingScheduling>) =>
    Effect.runPromise(Effect.provide(effect, layer))
  return { scenario, store, run }
}

describe('Booking Scheduling', () => {
  it('property: every offered interval has the selected duration and excludes commitments', async () => {
    for (const [primaryMinutes, additionalMinutes] of [
      [15, 15],
      [30, 45],
      [45, 60],
      [60, 30],
      [75, 15]
    ] as const) {
      const { scenario, run } = await fixture()
      const primary = scenario.services.find(
        (service) => service.id === 'svc_seed_signature_cut'
      )!
      const additional = scenario.services.find(
        (service) => service.id === 'svc_seed_beard_detail'
      )!
      ;(primary as { durationMinutes: number }).durationMinutes = primaryMinutes
      ;(additional as { durationMinutes: number }).durationMinutes = additionalMinutes

      const availability = await run(
        Effect.flatMap(BookingScheduling, (scheduling) =>
          scheduling.availability(session('bsn_one'), {
            from: '2026-07-13T00:00:00.000Z',
            days: 1,
            now
          })
        )
      )
      const expectedDuration = (primaryMinutes + additionalMinutes) * 60_000
      expect(
        availability.slots.every(
          (slot) =>
            Date.parse(slot.endsAt) - Date.parse(slot.startsAt) === expectedDuration
        )
      ).toBe(true)
      expect(
        availability.slots.every(
          (slot) =>
            !scenario.appointments.some(
              (appointment) =>
                appointment.status === 'scheduled' &&
                slot.startsAt < appointment.endsAt &&
                slot.endsAt > appointment.startsAt
            )
        )
      ).toBe(true)
      expect(availability.slots).toEqual(
        [...availability.slots].sort((left, right) =>
          left.startsAt.localeCompare(right.startsAt)
        )
      )
      expect(new Set(availability.slots.map((slot) => slot.startsAt)).size).toBe(
        availability.slots.length
      )
    }
  })

  it('derives unpersisted Availability from all Services and excludes Appointments', async () => {
    const { store, run } = await fixture()
    const availability = await run(
      Effect.flatMap(BookingScheduling, (scheduling) =>
        scheduling.availability(session('bsn_one'), {
          from: '2026-07-13T00:00:00.000Z',
          days: 1,
          now
        })
      )
    )

    expect(availability.timezone).toBe('Europe/Bucharest')
    expect(availability.slots).toContainEqual({
      startsAt: '2026-07-13T06:00:00.000Z',
      endsAt: '2026-07-13T07:30:00.000Z'
    })
    expect(availability.slots).not.toContainEqual(
      expect.objectContaining({ startsAt: '2026-07-13T09:00:00.000Z' })
    )
    expect(store.holds.size).toBe(0)
  })

  it('interprets Schedule Rules in the selected Shop timezone', async () => {
    const { store, run } = await fixture()
    const selectedShop = [...store.selections.shops.values()][0]!
    ;(selectedShop as { timezone?: string }).timezone = 'America/New_York'

    const availability = await run(
      Effect.flatMap(BookingScheduling, (scheduling) =>
        scheduling.availability(session('bsn_one'), {
          from: '2026-07-13T04:00:00.000Z',
          days: 1,
          now
        })
      )
    )

    expect(availability.timezone).toBe('America/New_York')
    expect(availability.slots).toContainEqual({
      startsAt: '2026-07-13T13:00:00.000Z',
      endsAt: '2026-07-13T14:30:00.000Z'
    })
  })

  it('atomically assigns Any Provider and freezes an exact ten-minute quote', async () => {
    const { scenario, store, run } = await fixture()
    const held = await run(
      Effect.flatMap(BookingScheduling, (scheduling) =>
        scheduling.hold(session('bsn_one'), {
          startsAt: '2026-07-13T06:00:00.000Z',
          now
        })
      )
    )

    expect(held.expiresAt).toBe('2026-07-10T09:40:00.000Z')
    expect(held.quote.providerPreference).toEqual({ kind: 'any' })
    expect(held.quote.assignedProvider.id).toBe('prv_seed_default')
    expect(held.quote.services.map(({ role, id }) => ({ role, id }))).toEqual([
      { role: 'primary', id: 'svc_seed_signature_cut' },
      { role: 'additional', id: 'svc_seed_beard_detail' }
    ])
    expect(held.quote).toMatchObject({
      durationMinutes: 90,
      currency: 'RON',
      totalMinor: 13_500
    })
    expect(held.quote.services.every((service) => service.priceMinor > 0)).toBe(true)
    expect(new Set(held.quote.services.map((service) => service.currency))).toEqual(
      new Set(['RON'])
    )

    const signature = scenario.services.find(
      (service) => service.id === 'svc_seed_signature_cut'
    )!
    ;(signature as { priceMinor: number }).priceMinor = 99_999
    ;(signature as { status: 'active' | 'inactive' }).status = 'inactive'
    ;(scenario.providers[0] as { status: 'active' | 'inactive' }).status = 'inactive'
    ;(scenario.publicBookingPage as { status: 'published' | 'unpublished' }).status =
      'unpublished'
    const reread = await run(
      Effect.flatMap(BookingScheduling, (scheduling) =>
        scheduling.currentHold(session('bsn_one'), {
          now: '2026-07-10T09:35:00.000Z'
        })
      )
    )
    expect(reread?.expiresAt).toBe(held.expiresAt)
    expect(reread?.quote.totalMinor).toBe(13_500)
    store.selections.selections.set('bsn_one', {
      providerPreference: null,
      primaryServiceId: null,
      additionalServiceIds: []
    })
    const heldAvailability = await run(
      Effect.flatMap(BookingScheduling, (scheduling) =>
        scheduling.availability(session('bsn_one'), {
          from: '2026-07-13T00:00:00.000Z',
          days: 1,
          now: '2026-07-10T09:35:00.000Z'
        })
      )
    )
    expect(heldAvailability).toMatchObject({
      slots: [],
      hold: { quote: { totalMinor: 13_500 } }
    })
  })

  it('prevents competing holds, releases expiry, and preserves upstream selections', async () => {
    const { store, run } = await fixture()
    const startsAt = '2026-07-13T06:00:00.000Z'
    await run(
      Effect.flatMap(BookingScheduling, (scheduling) =>
        scheduling.hold(session('bsn_one'), { startsAt, now })
      )
    )
    const lost = await run(
      Effect.result(
        Effect.flatMap(BookingScheduling, (scheduling) =>
          scheduling.hold(session('bsn_two'), {
            startsAt,
            now: '2026-07-10T09:31:00.000Z'
          })
        )
      )
    )
    expect(lost).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'BookingSchedulingRejected', reason: 'slot_lost' }
    })
    expect(store.selections.selections.get('bsn_two')).toMatchObject({
      providerPreference: { kind: 'any' },
      primaryServiceId: 'svc_seed_signature_cut',
      additionalServiceIds: ['svc_seed_beard_detail']
    })

    const afterExpiry = await run(
      Effect.flatMap(BookingScheduling, (scheduling) =>
        scheduling.hold(session('bsn_two'), {
          startsAt,
          now: '2026-07-10T09:41:00.000Z'
        })
      )
    )
    expect(afterExpiry.bookingSessionId).toBe('bsn_two')
  })

  it('rejects elapsed slots and providers outside the selected Shop', async () => {
    const { store, run } = await fixture()
    const bookingSession = session('bsn_one')
    const elapsed = await run(
      Effect.result(
        Effect.flatMap(BookingScheduling, (scheduling) =>
          scheduling.hold(bookingSession, {
            startsAt: '2026-07-06T06:00:00.000Z',
            now
          })
        )
      )
    )
    expect(elapsed).toMatchObject({
      _tag: 'Failure',
      failure: { reason: 'slot_lost' }
    })

    store.selections.shopProviders.clear()
    const unscoped = await run(
      Effect.result(
        Effect.flatMap(BookingScheduling, (scheduling) =>
          scheduling.availability(bookingSession, {
            from: '2026-07-13T00:00:00.000Z',
            days: 1,
            now
          })
        )
      )
    )
    expect(unscoped).toMatchObject({
      _tag: 'Failure',
      failure: { reason: 'not_ready' }
    })
  })

  it('releases a hold idempotently and invalidates it after a material selection change', async () => {
    const { store, run } = await fixture()
    const bookingSession = session('bsn_one')
    const startsAt = '2026-07-13T06:00:00.000Z'
    await run(
      Effect.flatMap(BookingScheduling, (scheduling) =>
        scheduling.hold(bookingSession, { startsAt, now })
      )
    )

    await run(
      Effect.flatMap(BookingScheduling, (scheduling) =>
        scheduling.release(bookingSession)
      )
    )
    await run(
      Effect.flatMap(BookingScheduling, (scheduling) =>
        scheduling.release(bookingSession)
      )
    )
    expect(store.holds.size).toBe(0)

    await run(
      Effect.flatMap(BookingScheduling, (scheduling) =>
        scheduling.hold(bookingSession, { startsAt, now })
      )
    )
    const selectionLayer = SeedBookingSelection(store.selections)
    await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(BookingSelection, (selection) =>
          selection.chooseServices(
            bookingSession,
            {
              primaryServiceId: 'svc_seed_signature_cut',
              additionalServiceIds: []
            },
            3
          )
        ),
        selectionLayer
      )
    )

    const invalidated = await run(
      Effect.flatMap(BookingScheduling, (scheduling) =>
        scheduling.currentHold(bookingSession, { now })
      )
    )
    expect(invalidated).toBeNull()
  })
})
