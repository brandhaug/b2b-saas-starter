import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  Database,
  layerFromD1,
  merchants,
  providerServiceEligibility,
  providers,
  publicBookingPages,
  scheduleRules,
  services
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
    expect(result.readiness.ready).toBe(true)
    expect(result.page.publicName).toBe('Live Schedule Studio')
    expect(result.rules).toHaveLength(1)
    expect(
      await runDb(Effect.flatMap(Database, (db) => db.select().from(scheduleRules)))
    ).toHaveLength(1)
  })
})
