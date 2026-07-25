import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  Database,
  appointments,
  brands,
  layerFromD1,
  merchants,
  providerServiceEligibility,
  providers,
  publicBookingPages,
  scheduleRules,
  services,
  shopAddresses,
  shops
} from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import {
  testMerchantContext,
  type MerchantContext
} from '../merchant-catalog/merchant-context.ts'
import {
  BookingPublication,
  LiveBookingPublication,
  LiveScheduling,
  Scheduling
} from './scheduling.ts'

let test: TestD1
const merchant = {
  id: 'mer_scheduling_live',
  publicName: 'Live Schedule Studio',
  slug: 'live-schedule-studio',
  timezone: 'Europe/Bucharest',
  currency: 'RON',
  plan: 'solo' as const
}

const runDb = <A, E>(effect: Effect.Effect<A, E, Database>) =>
  Effect.runPromise(Effect.provide(effect, layerFromD1(test.d1)))

const run = <A, E>(
  effect: Effect.Effect<A, E, Scheduling | BookingPublication | MerchantContext>
) =>
  Effect.runPromise(
    Effect.provide(
      effect,
      Layer.mergeAll(
        LiveScheduling,
        LiveBookingPublication,
        testMerchantContext(merchant)
      ).pipe(Layer.provide(layerFromD1(test.d1)))
    )
  )

beforeAll(async () => {
  test = await provisionTestD1()
  await runDb(
    Effect.gen(function* () {
      const db = yield* Database
      const now = '2026-07-10T09:30:00.000Z'
      yield* db
        .insert(merchants)
        .values({ ...merchant, createdAt: now, updatedAt: now })
      yield* db.insert(brands).values({
        id: 'brd_live_schedule',
        merchantId: merchant.id,
        name: merchant.publicName,
        createdAt: now,
        updatedAt: now
      })
      yield* db.insert(shops).values({
        id: 'shp_live_schedule',
        brandId: 'brd_live_schedule',
        merchantId: merchant.id,
        slug: merchant.slug,
        publicName: merchant.publicName,
        timezone: merchant.timezone,
        currency: merchant.currency,
        createdAt: now,
        updatedAt: now
      })
      yield* db.insert(shopAddresses).values({
        id: 'sad_live_schedule',
        shopId: 'shp_live_schedule',
        addressJson: JSON.stringify({ line1: 'Strada Test 10', locality: 'București' }),
        latitude: '44.43',
        longitude: '26.1',
        createdAt: now,
        updatedAt: now
      })
      yield* db.insert(providers).values({
        id: 'prv_live_schedule',
        merchantId: merchant.id,
        displayName: 'Live Provider',
        status: 'active',
        isDefault: true,
        createdAt: now,
        updatedAt: now
      })
      yield* db.insert(services).values({
        id: 'svc_live_schedule',
        merchantId: merchant.id,
        name: 'Live Service',
        description: null,
        category: null,
        priceMinor: 5000,
        currency: 'RON',
        durationMinutes: 60,
        status: 'active',
        createdAt: now,
        updatedAt: now
      })
      yield* db.insert(providerServiceEligibility).values({
        merchantId: merchant.id,
        providerId: 'prv_live_schedule',
        serviceId: 'svc_live_schedule',
        createdAt: now
      })
      yield* db.insert(appointments).values({
        id: 'apt_live_schedule_busy',
        merchantId: merchant.id,
        providerId: 'prv_live_schedule',
        status: 'scheduled',
        startsAt: '2026-07-13T07:00:00.000Z',
        endsAt: '2026-07-13T08:00:00.000Z',
        createdAt: now,
        updatedAt: now
      })
      yield* db.insert(publicBookingPages).values({
        id: 'pg_live_schedule',
        merchantId: merchant.id,
        status: 'unpublished',
        createdAt: now,
        updatedAt: now
      })
    })
  )
}, 60_000)

afterAll(async () => test.dispose())

describe('Live Scheduling and publication', () => {
  it('persists rules, derives Availability, publishes current data, and retains configuration on unpublish', async () => {
    const result = await run(
      Effect.gen(function* () {
        const scheduling = yield* Scheduling
        const publication = yield* BookingPublication
        yield* scheduling.saveProviderRules('prv_live_schedule', [
          { weekday: 1, startTime: '09:00', endTime: '12:00' }
        ])
        const availability = yield* scheduling.availability({
          providerId: 'prv_live_schedule',
          serviceId: 'svc_live_schedule',
          from: '2026-07-10T09:30:00.000Z',
          days: 7
        })
        const readiness = yield* publication.readiness()
        yield* publication.publish()
        const page = yield* publication.resolvePublished(merchant.slug)
        yield* publication.unpublish()
        return {
          availability,
          readiness,
          page,
          rules: yield* scheduling.listProviderRules('prv_live_schedule')
        }
      })
    )

    expect(result.availability.slots[0]?.startsAt).toBe('2026-07-13T06:00:00.000Z')
    expect(result.availability.slots.map((slot) => slot.startsAt)).not.toContain(
      '2026-07-13T07:00:00.000Z'
    )
    expect(result.readiness.ready).toBe(true)
    expect(result.page.publicName).toBe('Live Schedule Studio')
    expect(result.page.bookingPath).toBe('/live-schedule-studio/booking')
    expect(result.page.closingTime).toBe('12:00')
    expect(result.page.teamMembers).toEqual([
      { id: 'prv_live_schedule', displayName: 'Live Provider' }
    ])
    expect(result.page.location).toEqual({
      label: 'Strada Test 10, București',
      latitude: 44.43,
      longitude: 26.1
    })
    expect(result.rules).toHaveLength(1)
    expect(
      await runDb(Effect.flatMap(Database, (db) => db.select().from(scheduleRules)))
    ).toHaveLength(1)
  })
})
