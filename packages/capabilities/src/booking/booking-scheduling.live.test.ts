import { Effect, Layer } from 'effect'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  appointments,
  bookingSessions,
  Database,
  layerFromD1,
  merchants,
  providers,
  providerServiceEligibility,
  publicBookingPages,
  scheduleRules,
  services,
  timeSlotHolds
} from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { BookingSelection, LiveBookingSelection } from './booking-selection.ts'
import { BookingScheduling, LiveBookingScheduling } from './booking-scheduling.ts'
import {
  BookingSessions,
  LiveBookingSessions,
  type BookingSession
} from './booking-sessions.ts'

let test: TestD1
const now = '2026-07-10T09:30:00.000Z'

beforeAll(async () => {
  test = await provisionTestD1()
  await Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const db = yield* Database
        yield* db.insert(merchants).values({
          id: 'mer_schedule_hold',
          publicName: 'Schedule Hold',
          slug: 'schedule-hold',
          timezone: 'UTC',
          currency: 'USD',
          plan: 'team',
          createdAt: now,
          updatedAt: now
        })
        yield* db.insert(publicBookingPages).values({
          id: 'pg_schedule_hold',
          merchantId: 'mer_schedule_hold',
          status: 'published',
          createdAt: now,
          updatedAt: now
        })
        yield* db.insert(providers).values([
          {
            id: 'prv_schedule_one',
            merchantId: 'mer_schedule_hold',
            displayName: 'Ava',
            status: 'active',
            isDefault: true,
            createdAt: now,
            updatedAt: now
          },
          {
            id: 'prv_schedule_two',
            merchantId: 'mer_schedule_hold',
            displayName: 'Noah',
            status: 'active',
            isDefault: false,
            createdAt: now,
            updatedAt: now
          }
        ])
        yield* db.insert(services).values([
          {
            id: 'svc_schedule_primary',
            merchantId: 'mer_schedule_hold',
            name: 'Cut',
            priceMinor: 4000,
            currency: 'USD',
            durationMinutes: 40,
            status: 'active',
            createdAt: now,
            updatedAt: now
          },
          {
            id: 'svc_schedule_extra',
            merchantId: 'mer_schedule_hold',
            name: 'Finish',
            priceMinor: 1000,
            currency: 'USD',
            durationMinutes: 20,
            status: 'active',
            createdAt: now,
            updatedAt: now
          }
        ])
        yield* db.insert(providerServiceEligibility).values(
          ['prv_schedule_one', 'prv_schedule_two'].flatMap((providerId) =>
            ['svc_schedule_primary', 'svc_schedule_extra'].map((serviceId) => ({
              merchantId: 'mer_schedule_hold',
              providerId,
              serviceId,
              createdAt: now
            }))
          )
        )
        yield* db.insert(scheduleRules).values(
          ['prv_schedule_one', 'prv_schedule_two'].map((providerId) => ({
            id: `sch_${providerId}`,
            merchantId: 'mer_schedule_hold',
            providerId,
            weekday: 1,
            startTime: '09:00',
            endTime: '14:00',
            createdAt: now,
            updatedAt: now
          }))
        )
        yield* db.insert(appointments).values([
          {
            id: 'apt_schedule_block',
            merchantId: 'mer_schedule_hold',
            providerId: 'prv_schedule_one',
            status: 'scheduled',
            startsAt: '2026-07-13T11:00:00.000Z',
            endsAt: '2026-07-13T12:00:00.000Z',
            createdAt: now
          },
          {
            id: 'apt_completed_history',
            merchantId: 'mer_schedule_hold',
            providerId: 'prv_schedule_one',
            status: 'completed',
            startsAt: '2026-07-13T12:00:00.000Z',
            endsAt: '2026-07-13T13:00:00.000Z',
            createdAt: now
          }
        ])
      }),
      layerFromD1(test.d1)
    )
  )
}, 60_000)

afterAll(async () => test.dispose())

const prepareSession = async (
  selectedServices: {
    readonly primaryServiceId: string
    readonly additionalServiceIds: readonly string[]
  } = {
    primaryServiceId: 'svc_schedule_primary',
    additionalServiceIds: ['svc_schedule_extra']
  }
): Promise<BookingSession> => {
  const dbLayer = layerFromD1(test.d1)
  const session = await Effect.runPromise(
    Effect.provide(
      Effect.flatMap(BookingSessions, (sessions) =>
        sessions.start({ merchantSlug: 'schedule-hold', now })
      ),
      LiveBookingSessions.pipe(Layer.provide(dbLayer))
    )
  )
  const layer = LiveBookingSelection.pipe(Layer.provide(dbLayer))
  await Effect.runPromise(
    Effect.provide(
      Effect.flatMap(BookingSelection, (selection) =>
        selection.chooseProvider(session.session, {
          kind: 'specific',
          providerId: 'prv_schedule_one'
        })
      ),
      layer
    )
  )
  await Effect.runPromise(
    Effect.provide(
      Effect.flatMap(BookingSelection, (selection) =>
        selection.chooseServices(session.session, {
          primaryServiceId: selectedServices.primaryServiceId,
          additionalServiceIds: selectedServices.additionalServiceIds
        })
      ),
      layer
    )
  )
  return session.session
}

describe('Live Booking Scheduling', () => {
  it('excludes Appointment conflicts and allows at most one concurrent hold per Provider interval', async () => {
    const [first, second] = await Promise.all([prepareSession(), prepareSession()])
    const schedulingLayer = LiveBookingScheduling.pipe(
      Layer.provide(layerFromD1(test.d1))
    )
    const run = <A, E>(effect: Effect.Effect<A, E, BookingScheduling>) =>
      Effect.runPromise(Effect.provide(effect, schedulingLayer))
    const availability = await run(
      Effect.flatMap(BookingScheduling, (scheduling) =>
        scheduling.availability(first, {
          from: '2026-07-13T00:00:00.000Z',
          days: 1,
          now
        })
      )
    )
    expect(availability.slots.map((slot) => slot.startsAt)).not.toContain(
      '2026-07-13T11:00:00.000Z'
    )
    expect(availability.slots.map((slot) => slot.startsAt)).toContain(
      '2026-07-13T12:00:00.000Z'
    )

    const attempt = (session: BookingSession) =>
      run(
        Effect.result(
          Effect.flatMap(BookingScheduling, (scheduling) =>
            scheduling.hold(session, {
              startsAt: '2026-07-13T09:00:00.000Z',
              now
            })
          )
        )
      )
    const results = await Promise.all([attempt(first), attempt(second)])
    expect(results.filter((result) => result._tag === 'Success')).toHaveLength(1)
    expect(results.filter((result) => result._tag === 'Failure')).toHaveLength(1)
    const rows = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(Database, (db) => db.select().from(timeSlotHolds)),
        layerFromD1(test.d1)
      )
    )
    expect(rows).toHaveLength(1)
    const winner = results.find((result) => result._tag === 'Success')
    expect(winner).toMatchObject({
      _tag: 'Success',
      success: {
        quote: { assignedProvider: { id: 'prv_schedule_one' } }
      }
    })
    if (winner?._tag === 'Success') {
      const reread = await run(
        Effect.flatMap(BookingScheduling, (scheduling) =>
          scheduling.currentHold(
            winner.success.bookingSessionId === first.id ? first : second,
            { now: '2026-07-10T09:35:00.000Z' }
          )
        )
      )
      expect(reread?.expiresAt).toBe(winner.success.expiresAt)
    }

    const overlapping = await prepareSession({
      primaryServiceId: 'svc_schedule_extra',
      additionalServiceIds: []
    })
    const overlapResult = await run(
      Effect.result(
        Effect.flatMap(BookingScheduling, (scheduling) =>
          scheduling.hold(overlapping, {
            startsAt: '2026-07-13T09:20:00.000Z',
            now
          })
        )
      )
    )
    expect(overlapResult).toMatchObject({
      _tag: 'Failure',
      failure: { reason: 'slot_lost' }
    })
  })

  it('atomically refuses a Session that became inactive after authorization', async () => {
    const stale = await prepareSession()
    const dbLayer = layerFromD1(test.d1)
    await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(Database, (db) =>
          db
            .update(bookingSessions)
            .set({ lifecycle: 'consumed' })
            .where(eq(bookingSessions.id, stale.id))
        ),
        dbLayer
      )
    )
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.result(
          Effect.flatMap(BookingScheduling, (scheduling) =>
            scheduling.hold(stale, {
              startsAt: '2026-07-13T13:00:00.000Z',
              now
            })
          )
        ),
        LiveBookingScheduling.pipe(Layer.provide(dbLayer))
      )
    )
    expect(result).toMatchObject({
      _tag: 'Failure',
      failure: { reason: 'slot_lost' }
    })
  })

  it('keeps held quotes immutable and rebuilds them from current facts after expiry', async () => {
    const anySession = await prepareSession()
    const dbLayer = layerFromD1(test.d1)
    const selectionLayer = LiveBookingSelection.pipe(Layer.provide(dbLayer))
    await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(BookingSelection, (selection) =>
          selection.chooseProvider(anySession, { kind: 'any' })
        ),
        selectionLayer
      )
    )
    await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(BookingSelection, (selection) =>
          selection.chooseServices(anySession, {
            primaryServiceId: 'svc_schedule_primary',
            additionalServiceIds: ['svc_schedule_extra']
          })
        ),
        selectionLayer
      )
    )
    const schedulingLayer = LiveBookingScheduling.pipe(Layer.provide(dbLayer))
    const run = <A, E>(effect: Effect.Effect<A, E, BookingScheduling>) =>
      Effect.runPromise(Effect.provide(effect, schedulingLayer))
    const held = await run(
      Effect.flatMap(BookingScheduling, (scheduling) =>
        scheduling.hold(anySession, {
          startsAt: '2026-07-13T10:00:00.000Z',
          now
        })
      )
    )
    expect(held.quote).toMatchObject({
      providerPreference: { kind: 'any' },
      totalMinor: 5000,
      durationMinutes: 60
    })

    await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(Database, (db) =>
          db
            .update(services)
            .set({ priceMinor: 4500, updatedAt: '2026-07-10T09:35:00.000Z' })
            .where(eq(services.id, 'svc_schedule_primary'))
        ),
        dbLayer
      )
    )
    const reread = await run(
      Effect.flatMap(BookingScheduling, (scheduling) =>
        scheduling.currentHold(anySession, {
          now: '2026-07-10T09:39:59.000Z'
        })
      )
    )
    expect(reread?.expiresAt).toBe('2026-07-10T09:40:00.000Z')
    expect(reread?.quote.totalMinor).toBe(5000)

    await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const db = yield* Database
          yield* db
            .update(scheduleRules)
            .set({ startTime: '12:00', updatedAt: '2026-07-10T09:36:00.000Z' })
            .where(eq(scheduleRules.providerId, held.quote.assignedProvider.id))
          yield* db
            .update(publicBookingPages)
            .set({ status: 'unpublished', updatedAt: '2026-07-10T09:36:00.000Z' })
            .where(eq(publicBookingPages.merchantId, 'mer_schedule_hold'))
        }),
        dbLayer
      )
    )
    const afterMerchantEdits = await run(
      Effect.flatMap(BookingScheduling, (scheduling) =>
        scheduling.currentHold(anySession, {
          now: '2026-07-10T09:39:59.000Z'
        })
      )
    )
    expect(afterMerchantEdits?.quote).toEqual(held.quote)
    await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const db = yield* Database
          yield* db
            .update(scheduleRules)
            .set({ startTime: '09:00', updatedAt: '2026-07-10T09:40:00.000Z' })
            .where(eq(scheduleRules.providerId, held.quote.assignedProvider.id))
          yield* db
            .update(publicBookingPages)
            .set({ status: 'published', updatedAt: '2026-07-10T09:40:00.000Z' })
            .where(eq(publicBookingPages.merchantId, 'mer_schedule_hold'))
        }),
        dbLayer
      )
    )

    const replacement = await run(
      Effect.flatMap(BookingScheduling, (scheduling) =>
        scheduling.hold(anySession, {
          startsAt: '2026-07-13T10:00:00.000Z',
          now: '2026-07-10T09:41:00.000Z'
        })
      )
    )
    expect(replacement.quote.totalMinor).toBe(5500)
  })
})
