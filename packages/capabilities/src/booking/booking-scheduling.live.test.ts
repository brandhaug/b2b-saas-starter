import { Effect, Layer } from 'effect'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  appointments,
  brands,
  bookingSessions,
  Database,
  layerFromD1,
  merchants,
  merchantMemberships,
  merchantSubscriptions,
  providers,
  publicBookingPages,
  scheduleRules,
  services,
  shopProviders,
  shopServices,
  shops,
  timeSlotHolds,
  user
} from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { BookingSelection, LiveBookingSelection } from './booking-selection.ts'
import { BookingParties } from './foundations.ts'
import { LiveBookingParties } from './foundation-adapters.ts'
import { BookingScheduling, LiveBookingScheduling } from './booking-scheduling.ts'
import {
  BookingSessions,
  LiveBookingSessions,
  type BookingSession
} from './booking-sessions.ts'
import {
  LiveMerchantCatalog,
  MerchantCatalog
} from '../merchant-catalog/merchant-catalog.ts'
import { liveMerchantContext } from '../merchant-catalog/merchant-context.ts'

let test: TestD1
const now = '2026-07-10T09:30:00.000Z'
const issuedCapabilities = new Map<string, string>()

beforeAll(async () => {
  test = await provisionTestD1()
  await Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const db = yield* Database
        yield* db.insert(user).values({
          id: 'usr_schedule_owner',
          name: 'Schedule Owner',
          email: 'owner@schedule.test',
          emailVerified: true,
          identityClass: 'merchant_member',
          createdAt: new Date(now),
          updatedAt: new Date(now)
        })
        yield* db.insert(merchants).values({
          id: 'mer_schedule_hold',
          publicName: 'Schedule Hold',
          slug: 'schedule-hold',
          timezone: 'Europe/Bucharest',
          currency: 'USD',
          plan: 'solo',
          createdAt: now,
          updatedAt: now
        })
        yield* db.insert(merchantMemberships).values({
          merchantId: 'mer_schedule_hold',
          userId: 'usr_schedule_owner',
          role: 'owner',
          createdAt: now
        })
        yield* db.insert(merchantSubscriptions).values({
          id: 'sub_schedule_hold',
          merchantId: 'mer_schedule_hold',
          plan: 'solo',
          interval: 'monthly',
          status: 'active',
          currentPeriodEndsAt: '2026-08-10T09:30:00.000Z',
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
        yield* db.insert(brands).values({
          id: 'brd_schedule_hold',
          merchantId: 'mer_schedule_hold',
          name: 'Schedule Hold',
          createdAt: now,
          updatedAt: now
        })
        yield* db.insert(shops).values({
          id: 'shp_schedule_hold',
          brandId: 'brd_schedule_hold',
          merchantId: 'mer_schedule_hold',
          slug: 'schedule-hold',
          publicName: 'Schedule Hold',
          timezone: 'UTC',
          currency: 'USD',
          createdAt: now,
          updatedAt: now
        })
        yield* db.insert(providers).values([
          {
            id: 'prv_schedule_one',
            merchantId: 'mer_schedule_hold',
            linkedUserId: 'usr_schedule_owner',
            displayName: 'Ava',
            status: 'active',
            isDefault: true,
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
        yield* db.insert(shopProviders).values({
          shopId: 'shp_schedule_hold',
          providerId: 'prv_schedule_one',
          createdAt: now
        })
        yield* db.insert(shopServices).values(
          ['svc_schedule_primary', 'svc_schedule_extra'].map((serviceId) => ({
            shopId: 'shp_schedule_hold',
            serviceId,
            createdAt: now
          }))
        )
        yield* db.insert(scheduleRules).values({
          id: 'sch_prv_schedule_one',
          merchantId: 'mer_schedule_hold',
          providerId: 'prv_schedule_one',
          weekday: 1,
          startTime: '09:00',
          endTime: '14:00',
          createdAt: now,
          updatedAt: now
        })
        yield* db.insert(appointments).values([
          {
            id: 'apt_schedule_block',
            merchantId: 'mer_schedule_hold',
            providerId: 'prv_schedule_one',
            status: 'scheduled',
            startsAt: '2026-07-13T11:00:00.000Z',
            endsAt: '2026-07-13T12:00:00.000Z',
            createdAt: now,
            updatedAt: now
          },
          {
            id: 'apt_completed_history',
            merchantId: 'mer_schedule_hold',
            providerId: 'prv_schedule_one',
            status: 'completed',
            startsAt: '2026-07-13T12:00:00.000Z',
            endsAt: '2026-07-13T13:00:00.000Z',
            createdAt: now,
            updatedAt: now
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
  },
  sessionNow = now
): Promise<BookingSession> => {
  const dbLayer = layerFromD1(test.d1)
  const session = await Effect.runPromise(
    Effect.provide(
      Effect.flatMap(BookingSessions, (sessions) =>
        sessions.start({ merchantSlug: 'schedule-hold', now: sessionNow })
      ),
      LiveBookingSessions.pipe(Layer.provide(dbLayer))
    )
  )
  const layer = LiveBookingSelection.pipe(Layer.provide(dbLayer))
  issuedCapabilities.set(session.session.id, session.capability)
  await Effect.runPromise(
    Effect.provide(
      Effect.flatMap(BookingSelection, (selection) =>
        selection.chooseServices(
          session.session,
          {
            primaryServiceId: selectedServices.primaryServiceId,
            additionalServiceIds: selectedServices.additionalServiceIds
          },
          1
        )
      ),
      layer
    )
  )
  return session.session
}

describe('Live Booking Scheduling', () => {
  it('fails closed when persisted Service buffers are outside launch bounds', async () => {
    const session = await prepareSession({
      primaryServiceId: 'svc_schedule_primary',
      additionalServiceIds: []
    })
    const dbLayer = layerFromD1(test.d1)
    await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(Database, (db) =>
          db
            .update(services)
            .set({
              bookingConfigJson: {
                beforeBufferMinutes: -5,
                afterBufferMinutes: 125
              }
            })
            .where(eq(services.id, 'svc_schedule_primary'))
        ),
        dbLayer
      )
    )
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.result(
          Effect.flatMap(BookingScheduling, (scheduling) =>
            scheduling.availability(session, {
              from: '2026-07-13T00:00:00.000Z',
              days: 1,
              now
            })
          )
        ),
        LiveBookingScheduling.pipe(Layer.provide(dbLayer))
      )
    )
    expect(result).toMatchObject({
      _tag: 'Failure',
      failure: { reason: 'not_ready' }
    })
    await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(Database, (db) =>
          db
            .update(services)
            .set({ bookingConfigJson: null })
            .where(eq(services.id, 'svc_schedule_primary'))
        ),
        dbLayer
      )
    )
  })

  it('preserves only duration-edited holds that remain available', async () => {
    const dbLayer = layerFromD1(test.d1)
    const schedulingLayer = LiveBookingScheduling.pipe(Layer.provide(dbLayer))
    const catalogLayer = Layer.merge(
      LiveMerchantCatalog,
      liveMerchantContext('usr_schedule_owner')
    ).pipe(Layer.provide(dbLayer))
    const runScheduling = <A, E>(effect: Effect.Effect<A, E, BookingScheduling>) =>
      Effect.runPromise(Effect.provide(effect, schedulingLayer))
    const updateDuration = (durationMinutes: number) =>
      Effect.runPromise(
        Effect.provide(
          Effect.gen(function* () {
            const catalog = yield* MerchantCatalog
            const service = (yield* catalog.read()).services.find(
              (item) => item.id === 'svc_schedule_primary'
            )!
            return yield* catalog.updateService(service.id, {
              ...service,
              durationMinutes
            })
          }),
          catalogLayer
        )
      )
    const holdNow = new Date().toISOString()
    const nextMonday = new Date(holdNow)
    const daysUntilNextMonday = (8 - nextMonday.getUTCDay()) % 7 || 7
    nextMonday.setUTCDate(nextMonday.getUTCDate() + daysUntilNextMonday)
    nextMonday.setUTCHours(9, 0, 0, 0)
    const earlyStartsAt = nextMonday.toISOString()
    nextMonday.setUTCHours(13)
    const lateStartsAt = nextMonday.toISOString()
    const earlySession = await prepareSession(
      {
        primaryServiceId: 'svc_schedule_primary',
        additionalServiceIds: []
      },
      holdNow
    )
    const earlyHold = await runScheduling(
      Effect.flatMap(BookingScheduling, (scheduling) =>
        scheduling.hold(earlySession, {
          startsAt: earlyStartsAt,
          now: holdNow
        })
      )
    )
    await updateDuration(60)
    expect(
      await runScheduling(
        Effect.flatMap(BookingScheduling, (scheduling) =>
          scheduling.currentHold(earlySession, { now: holdNow })
        )
      )
    ).toMatchObject({ id: earlyHold.id })
    await runScheduling(
      Effect.flatMap(BookingScheduling, (scheduling) =>
        scheduling.release(earlySession)
      )
    )
    await updateDuration(40)

    const lateSession = await prepareSession(
      {
        primaryServiceId: 'svc_schedule_primary',
        additionalServiceIds: []
      },
      holdNow
    )
    await runScheduling(
      Effect.flatMap(BookingScheduling, (scheduling) =>
        scheduling.hold(lateSession, {
          startsAt: lateStartsAt,
          now: holdNow
        })
      )
    )
    await updateDuration(120)
    expect(
      await runScheduling(
        Effect.flatMap(BookingScheduling, (scheduling) =>
          scheduling.currentHold(lateSession, { now: holdNow })
        )
      )
    ).toBeNull()
    await updateDuration(40)
  })

  it('acquires and links every request hold in one live D1 batch', async () => {
    const session = await prepareSession()
    const schedulingLayer = LiveBookingScheduling.pipe(
      Layer.provide(layerFromD1(test.d1))
    )
    const runScheduling = <A, E>(effect: Effect.Effect<A, E, BookingScheduling>) =>
      Effect.runPromise(Effect.provide(effect, schedulingLayer))
    const first = await runScheduling(
      Effect.flatMap(BookingScheduling, (service) =>
        service.hold(session, { startsAt: '2026-07-13T09:00:00.000Z', now })
      )
    )
    await runScheduling(
      Effect.flatMap(BookingScheduling, (service) => service.release(session))
    )
    const second = await runScheduling(
      Effect.flatMap(BookingScheduling, (service) =>
        service.hold(session, { startsAt: '2026-07-13T10:00:00.000Z', now })
      )
    )
    await runScheduling(
      Effect.flatMap(BookingScheduling, (service) => service.release(session))
    )

    const partyLayer = LiveBookingParties.pipe(Layer.provide(layerFromD1(test.d1)))
    const runParty = <A, E>(effect: Effect.Effect<A, E, BookingParties>) =>
      Effect.runPromise(Effect.provide(effect, partyLayer))
    let party = await runParty(
      Effect.flatMap(BookingParties, (service) => service.findForSession(session.id))
    )
    const firstRequestId = party.requests[0]!.id
    party = await runParty(
      Effect.flatMap(BookingParties, (service) =>
        service.addRequest(party.id, party.version, now)
      )
    )
    const secondRequestId = party.requests[1]!.id
    party = await runParty(
      Effect.flatMap(BookingParties, (service) =>
        service.activateRequest(party.id, secondRequestId, party.version, now)
      )
    )
    await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(BookingSelection, (selection) =>
          selection.chooseServices(
            session,
            {
              primaryServiceId: 'svc_schedule_primary',
              additionalServiceIds: ['svc_schedule_extra']
            },
            party.version
          )
        ),
        LiveBookingSelection.pipe(Layer.provide(layerFromD1(test.d1)))
      )
    )
    party = await runParty(
      Effect.flatMap(BookingParties, (service) => service.findForSession(session.id))
    )

    const competitor = await prepareSession()
    await runScheduling(
      Effect.flatMap(BookingScheduling, (service) =>
        service.hold(competitor, { startsAt: first.quote.startsAt, now })
      )
    )
    const conflict = await runScheduling(
      Effect.result(
        Effect.flatMap(BookingScheduling, (service) =>
          service.holdParty(session, {
            now,
            requests: [
              { bookingRequestId: firstRequestId, startsAt: first.quote.startsAt },
              { bookingRequestId: secondRequestId, startsAt: second.quote.startsAt }
            ]
          })
        )
      )
    )
    expect(conflict).toMatchObject({
      _tag: 'Failure',
      failure: { reason: 'slot_lost' }
    })
    const afterConflict = await runParty(
      Effect.flatMap(BookingParties, (service) => service.findForSession(session.id))
    )
    expect(afterConflict.requests.every((request) => request.holdId === null)).toBe(
      true
    )
    await runScheduling(
      Effect.flatMap(BookingScheduling, (service) => service.release(competitor))
    )

    await runScheduling(
      Effect.flatMap(BookingScheduling, (service) =>
        service.hold(session, { startsAt: first.quote.startsAt, now })
      )
    )
    party = await runParty(
      Effect.flatMap(BookingParties, (service) => service.findForSession(session.id))
    )
    party = await runParty(
      Effect.flatMap(BookingParties, (service) =>
        service.activateRequest(party.id, secondRequestId, party.version, now)
      )
    )
    await runScheduling(
      Effect.flatMap(BookingScheduling, (service) =>
        service.hold(session, { startsAt: second.quote.startsAt, now })
      )
    )
    const held = await runScheduling(
      Effect.flatMap(BookingScheduling, (service) =>
        service.holdParty(session, {
          now,
          requests: [
            {
              bookingRequestId: firstRequestId,
              startsAt: first.quote.startsAt
            },
            {
              bookingRequestId: secondRequestId,
              startsAt: second.quote.startsAt
            }
          ]
        })
      )
    )
    expect(held).toHaveLength(2)
    const persisted = await runParty(
      Effect.flatMap(BookingParties, (service) => service.findForSession(session.id))
    )
    expect(
      persisted.requests.every((request) => request.holdId && request.holdExpiresAt)
    ).toBe(true)
    await runScheduling(
      Effect.flatMap(BookingScheduling, (service) => service.release(session))
    )
    await runParty(
      Effect.flatMap(BookingParties, (service) =>
        service.activateRequest(persisted.id, firstRequestId, persisted.version, now)
      )
    )
    await runScheduling(
      Effect.flatMap(BookingScheduling, (service) => service.release(session))
    )
  }, 15_000)
  it('excludes Appointment conflicts and allows at most one concurrent hold per Provider interval', async () => {
    const contenders: BookingSession[] = []
    while (contenders.length < 25) {
      contenders.push(...(await Promise.all([prepareSession(), prepareSession()])))
    }
    contenders.length = 25
    const first = contenders[0]!
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
    const selected = await test.d1
      .prepare(
        `SELECT s.lifecycle, s.provider_preference providerPreference, s.provider_id providerId,
                s.primary_service_id primaryServiceId, p.shop_id shopId
         FROM booking_sessions s
         JOIN booking_parties p ON p.booking_session_id = s.id
         WHERE s.id = ?`
      )
      .bind(first.id)
      .first()
    expect(selected).toEqual({
      lifecycle: 'active',
      providerPreference: 'specific',
      providerId: 'prv_schedule_one',
      primaryServiceId: 'svc_schedule_primary',
      shopId: 'shp_schedule_hold'
    })

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
    const results = await Promise.all(contenders.map(attempt))
    expect(results.filter((result) => result._tag === 'Success')).toHaveLength(1)
    const losers = results.filter((result) => result._tag === 'Failure')
    expect(losers).toHaveLength(24)
    expect(losers.every((result) => result.failure.reason === 'slot_lost')).toBe(true)
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
      const winningSession = contenders.find(
        (contender) => contender.id === winner.success.bookingSessionId
      )!
      const activeAfterUnrelatedSessionActivity = await Effect.runPromise(
        Effect.provide(
          Effect.flatMap(BookingSessions, (sessions) =>
            sessions.authorize({
              merchantSlug: winningSession.merchantSlug,
              sessionId: winningSession.id,
              capability: issuedCapabilities.get(winningSession.id)!,
              now: '2026-07-10T09:35:00.000Z'
            })
          ),
          LiveBookingSessions.pipe(Layer.provide(layerFromD1(test.d1)))
        )
      )
      const reread = await run(
        Effect.flatMap(BookingScheduling, (scheduling) =>
          scheduling.currentHold(activeAfterUnrelatedSessionActivity, {
            now: '2026-07-10T09:35:00.000Z'
          })
        )
      )
      expect(reread?.expiresAt).toBe(winner.success.expiresAt)
      const afterAvailabilityRead = await run(
        Effect.flatMap(BookingScheduling, (scheduling) =>
          scheduling.availability(activeAfterUnrelatedSessionActivity, {
            from: '2026-07-13T00:00:00.000Z',
            days: 1,
            now: '2026-07-10T09:35:00.000Z'
          })
        )
      )
      expect(afterAvailabilityRead.hold?.expiresAt).toBe(winner.success.expiresAt)
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
  }, 30_000)

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
      providerPreference: { kind: 'specific', providerId: 'prv_schedule_one' },
      assignedProvider: { id: 'prv_schedule_one' },
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
