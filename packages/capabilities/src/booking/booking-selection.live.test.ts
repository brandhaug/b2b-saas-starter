import { Effect, Layer } from 'effect'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  Database,
  layerFromD1,
  merchants,
  providers,
  providerServiceEligibility,
  publicBookingPages,
  services
} from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { BookingSessions, LiveBookingSessions } from './booking-sessions.ts'
import { BookingSelection, LiveBookingSelection } from './booking-selection.ts'

let test: TestD1
const now = '2026-07-10T10:00:00.000Z'

beforeAll(async () => {
  test = await provisionTestD1()
  await Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const db = yield* Database
        yield* db.insert(merchants).values({
          id: 'mer_selection',
          publicName: 'Selection',
          slug: 'selection',
          timezone: 'UTC',
          currency: 'USD',
          plan: 'team',
          createdAt: now,
          updatedAt: now
        })
        yield* db.insert(publicBookingPages).values({
          id: 'pg_selection',
          merchantId: 'mer_selection',
          status: 'published',
          createdAt: now,
          updatedAt: now
        })
        yield* db.insert(providers).values([
          {
            id: 'prv_one',
            merchantId: 'mer_selection',
            displayName: 'One',
            status: 'active',
            isDefault: true,
            createdAt: now,
            updatedAt: now
          },
          {
            id: 'prv_two',
            merchantId: 'mer_selection',
            displayName: 'Two',
            status: 'active',
            isDefault: false,
            createdAt: now,
            updatedAt: now
          }
        ])
        yield* db.insert(services).values([
          {
            id: 'svc_primary',
            merchantId: 'mer_selection',
            name: 'Primary',
            category: 'Cuts',
            priceMinor: 4000,
            currency: 'USD',
            durationMinutes: 40,
            status: 'active',
            createdAt: now,
            updatedAt: now
          },
          {
            id: 'svc_extra',
            merchantId: 'mer_selection',
            name: 'Extra',
            category: 'Add-ons',
            priceMinor: 1000,
            currency: 'USD',
            durationMinutes: 10,
            status: 'active',
            createdAt: now,
            updatedAt: now
          }
        ])
        yield* db.insert(providerServiceEligibility).values([
          {
            merchantId: 'mer_selection',
            providerId: 'prv_one',
            serviceId: 'svc_primary',
            createdAt: now
          },
          {
            merchantId: 'mer_selection',
            providerId: 'prv_one',
            serviceId: 'svc_extra',
            createdAt: now
          }
        ])
      }),
      layerFromD1(test.d1)
    )
  )
}, 60_000)

afterAll(async () => test.dispose())

describe('Live Booking Selection', () => {
  it('atomically persists Any Provider and ordered Services across layer recreation', async () => {
    const dbLayer = layerFromD1(test.d1)
    const sessionsLayer = LiveBookingSessions.pipe(Layer.provide(dbLayer))
    const issued = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(BookingSessions, (sessions) =>
          sessions.start({ merchantSlug: 'selection', now })
        ),
        sessionsLayer
      )
    )
    const selectionLayer = LiveBookingSelection.pipe(Layer.provide(dbLayer))
    await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(BookingSelection, (selection) =>
          selection.chooseProvider(issued.session, { kind: 'any' })
        ),
        selectionLayer
      )
    )
    await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(BookingSelection, (selection) =>
          selection.chooseServices(issued.session, {
            primaryServiceId: 'svc_primary',
            additionalServiceIds: ['svc_extra']
          })
        ),
        selectionLayer
      )
    )

    const refreshedLayer = LiveBookingSelection.pipe(
      Layer.provide(layerFromD1(test.d1))
    )
    const refreshed = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(BookingSelection, (selection) => selection.load(issued.session)),
        refreshedLayer
      )
    )
    expect(refreshed.providerPreference).toEqual({ kind: 'any' })
    expect(refreshed.selection).toEqual({
      primaryServiceId: 'svc_primary',
      additionalServiceIds: ['svc_extra']
    })

    await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(Database, (db) =>
          db
            .update(providers)
            .set({ status: 'inactive' })
            .where(eq(providers.id, 'prv_one'))
        ),
        layerFromD1(test.d1)
      )
    )
    const normalized = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(BookingSelection, (selection) => selection.load(issued.session)),
        refreshedLayer
      )
    )
    expect(normalized.providerPreference).toBeNull()
    expect(normalized.selection).toEqual({
      primaryServiceId: null,
      additionalServiceIds: []
    })
  })
})
