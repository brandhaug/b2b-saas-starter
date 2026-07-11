import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  brands,
  bookingParties,
  bookingRequests,
  bookingSessions,
  Database,
  layerFromD1,
  merchants,
  publicBookingPages,
  shops
} from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import {
  BookingSessions,
  enterBookingSession,
  LiveBookingSessions
} from './booking-sessions.ts'

let test: TestD1
const now = '2026-07-10T10:00:00.000Z'

beforeAll(async () => {
  test = await provisionTestD1()
  await Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const db = yield* Database
        yield* db.insert(merchants).values({
          id: 'mer_live_booking',
          publicName: 'Live Booking',
          slug: 'live-booking',
          timezone: 'UTC',
          currency: 'EUR',
          createdAt: now,
          updatedAt: now
        })
        yield* db.insert(publicBookingPages).values({
          id: 'pg_live_booking',
          merchantId: 'mer_live_booking',
          status: 'published',
          createdAt: now,
          updatedAt: now
        })
        yield* db.insert(brands).values({
          id: 'brd_live_booking',
          merchantId: 'mer_live_booking',
          name: 'Live Booking',
          createdAt: now,
          updatedAt: now
        })
        yield* db.insert(shops).values({
          id: 'shp_live_booking',
          brandId: 'brd_live_booking',
          merchantId: 'mer_live_booking',
          slug: 'live-booking',
          publicName: 'Live Booking',
          timezone: 'UTC',
          currency: 'EUR',
          createdAt: now,
          updatedAt: now
        })
      }),
      layerFromD1(test.d1)
    )
  )
}, 60_000)

afterAll(async () => test.dispose())

describe('Live Booking Sessions', () => {
  it('persists only the capability hash and authorizes the issued session', async () => {
    const layer = LiveBookingSessions.pipe(Layer.provide(layerFromD1(test.d1)))
    const issued = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(BookingSessions, (sessions) =>
          sessions.start({ merchantSlug: 'live-booking', now })
        ),
        layer
      )
    )
    const authorized = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(BookingSessions, (sessions) =>
          sessions.authorize({
            merchantSlug: 'live-booking',
            sessionId: issued.session.id,
            capability: issued.capability,
            now: '2026-07-10T10:05:00.000Z'
          })
        ),
        layer
      )
    )

    expect(authorized.id).toBe(issued.session.id)
    await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(BookingSessions, (sessions) =>
          sessions.captureContext(authorized, {
            locale: 'es',
            embedding: 'widget',
            acquisition: { gclid: 'captured-once' }
          })
        ),
        layer
      )
    )
    await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(Database, (db) =>
          db.update(publicBookingPages).set({ status: 'unpublished' })
        ),
        layerFromD1(test.d1)
      )
    )
    const resumed = await Effect.runPromise(
      Effect.provide(
        enterBookingSession({
          merchantSlug: 'live-booking',
          candidates: [{ sessionId: issued.session.id, capability: issued.capability }],
          now: '2026-07-10T10:10:00.000Z'
        }),
        layer
      )
    )
    expect(resumed).toMatchObject({
      kind: 'resumed',
      session: { id: issued.session.id }
    })
    const blocked = await Effect.runPromise(
      Effect.provide(
        Effect.result(
          Effect.flatMap(BookingSessions, (sessions) =>
            sessions.start({ merchantSlug: 'live-booking', now })
          )
        ),
        layer
      )
    )
    expect(blocked._tag).toBe('Failure')
    if (blocked._tag === 'Failure') {
      expect(blocked.failure._tag).toBe('BookingPageUnavailable')
    }
    const rows = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(Database, (db) => db.select().from(bookingSessions)),
        layerFromD1(test.d1)
      )
    )
    expect(rows[0]?.capabilityHash).toMatch(/^[a-f0-9]{64}$/)
    expect(rows[0]).toMatchObject({
      locale: 'es',
      embeddingProfile: 'widget',
      acquisitionJson: JSON.stringify({ gclid: 'captured-once' })
    })
    expect(JSON.stringify(rows[0])).not.toContain(issued.capability)
    const parties = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(Database, (db) =>
          Effect.all([
            db.select().from(bookingParties),
            db.select().from(bookingRequests)
          ])
        ),
        layerFromD1(test.d1)
      )
    )
    expect(parties[0]).toHaveLength(1)
    expect(parties[0][0]).toMatchObject({
      bookingSessionId: issued.session.id,
      shopId: 'shp_live_booking',
      locale: 'es',
      version: 1
    })
    expect(parties[1]).toHaveLength(1)
    expect(parties[1][0]).toMatchObject({
      bookingPartyId: parties[0][0]?.id,
      position: 0
    })
  })
})
