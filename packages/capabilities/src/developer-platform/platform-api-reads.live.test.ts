import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Effect } from 'effect'
import {
  appointments,
  Database,
  layerFromD1,
  merchants,
  providerServiceEligibility,
  providers,
  publicBookingPages,
  services
} from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { LivePlatformApiReads, PlatformApiReads } from './platform-api-reads.ts'

let testD1: TestD1
const now = '2026-07-10T09:30:00.000Z'
const snapshot = {
  startsAt: '2026-07-12T09:00:00.000Z',
  endsAt: '2026-07-12T09:45:00.000Z',
  providerPreference: { kind: 'any' as const },
  assignedProvider: { id: 'prv_live_read', displayName: 'Ava' },
  services: [
    {
      id: 'svc_live_read',
      role: 'primary' as const,
      name: 'Cut',
      durationMinutes: 45,
      beforeBufferMinutes: 0,
      afterBufferMinutes: 0,
      priceMinor: 5000,
      currency: 'RON'
    }
  ],
  durationMinutes: 45,
  beforeBufferMinutes: 0,
  afterBufferMinutes: 0,
  occupiedStartsAt: '2026-07-12T09:00:00.000Z',
  occupiedEndsAt: '2026-07-12T09:45:00.000Z',
  currency: 'RON',
  totalMinor: 5000,
  merchantTimezone: 'Europe/Bucharest',
  customerDetails: { name: 'Mia', email: 'mia@example.com', phone: null },
  checkoutPath: 'pay_in_person' as const
}

beforeAll(async () => {
  testD1 = await provisionTestD1()
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = yield* Database
      yield* db.insert(merchants).values({
        id: 'mer_live_read',
        publicName: 'Live Studio',
        slug: 'live-studio',
        timezone: 'Europe/Bucharest',
        currency: 'RON',
        plan: 'solo',
        createdAt: now,
        updatedAt: now
      })
      yield* db.insert(merchants).values({
        id: 'mer_other',
        publicName: 'Other Studio',
        slug: 'other-studio',
        timezone: 'UTC',
        currency: 'EUR',
        plan: 'solo',
        createdAt: now,
        updatedAt: now
      })
      yield* db.insert(publicBookingPages).values({
        id: 'pg_live_read',
        merchantId: 'mer_live_read',
        status: 'published',
        createdAt: now,
        updatedAt: now
      })
      yield* db.insert(providers).values({
        id: 'prv_live_read',
        merchantId: 'mer_live_read',
        linkedUserId: null,
        displayName: 'Ava',
        status: 'active',
        isDefault: true,
        createdAt: now,
        updatedAt: now
      })
      yield* db.insert(services).values({
        id: 'svc_live_read',
        merchantId: 'mer_live_read',
        name: 'Cut',
        description: null,
        category: null,
        priceMinor: 5000,
        currency: 'RON',
        durationMinutes: 45,
        status: 'active',
        createdAt: now,
        updatedAt: now
      })
      yield* db.insert(providerServiceEligibility).values({
        merchantId: 'mer_live_read',
        providerId: 'prv_live_read',
        serviceId: 'svc_live_read',
        createdAt: now
      })
      yield* db.insert(appointments).values({
        id: 'apt_live_read',
        merchantId: 'mer_live_read',
        providerId: 'prv_live_read',
        bookingSessionId: null,
        status: 'scheduled',
        startsAt: snapshot.startsAt,
        endsAt: snapshot.endsAt,
        snapshot,
        createdAt: now,
        updatedAt: now
      })
    }).pipe(Effect.provide(layerFromD1(testD1.d1)))
  )
}, 30_000)
afterAll(async () => testD1?.dispose())

const run = <A>(effect: Effect.Effect<A, unknown, PlatformApiReads>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(LivePlatformApiReads('test-cursor-secret')),
      Effect.provide(layerFromD1(testD1.d1))
    )
  )

describe('LivePlatformApiReads', () => {
  test('projects merchant-scoped catalog and immutable Appointment snapshots from real D1', async () => {
    const result = await run(
      Effect.gen(function* () {
        const api = yield* PlatformApiReads
        return {
          merchant: yield* api.merchant('mer_live_read'),
          services: yield* api.services('mer_live_read', {}),
          providers: yield* api.providers('mer_live_read', {}),
          appointment: yield* api.appointment('mer_live_read', 'apt_live_read')
        }
      })
    )
    expect(result.merchant.publicPage.status).toBe('published')
    expect(result.services.data[0]?.providerIds).toEqual(['prv_live_read'])
    expect(result.providers.data[0]?.serviceIds).toEqual(['svc_live_read'])
    expect(result.appointment.customer.email).toBe('mia@example.com')
    expect(JSON.stringify(result.appointment)).not.toContain('merchantId')
  })

  test('makes cross-Merchant detail reads indistinguishable from missing resources', async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const api = yield* PlatformApiReads
        return yield* api.appointment('mer_other', 'apt_live_read')
      }).pipe(
        Effect.provide(LivePlatformApiReads('test-cursor-secret')),
        Effect.provide(layerFromD1(testD1.d1))
      )
    )
    expect(exit._tag).toBe('Failure')
  })
})
