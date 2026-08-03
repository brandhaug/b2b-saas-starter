import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  brands,
  Database,
  layerFromD1,
  merchantMemberships,
  merchants,
  merchantSubscriptions,
  providers,
  publicBookingPages,
  services,
  shopAddresses,
  shopProviders,
  shopServices,
  shops,
  user
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
        yield* db.insert(user).values({
          id: 'usr_selection_owner',
          name: 'Selection Owner',
          email: 'owner@selection.test',
          emailVerified: true,
          identityClass: 'merchant_member',
          createdAt: new Date(now),
          updatedAt: new Date(now)
        })
        yield* db.insert(merchants).values({
          id: 'mer_selection',
          publicName: 'Selection',
          slug: 'selection',
          timezone: 'UTC',
          currency: 'USD',
          plan: 'solo',
          createdAt: now,
          updatedAt: now
        })
        yield* db.insert(merchantMemberships).values({
          merchantId: 'mer_selection',
          userId: 'usr_selection_owner',
          role: 'owner',
          createdAt: now
        })
        yield* db.insert(merchantSubscriptions).values({
          id: 'sub_selection',
          merchantId: 'mer_selection',
          plan: 'solo',
          interval: 'monthly',
          status: 'active',
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
        yield* db.insert(brands).values({
          id: 'brd_selection',
          merchantId: 'mer_selection',
          name: 'Selection',
          createdAt: now,
          updatedAt: now
        })
        yield* db.insert(shops).values({
          id: 'shp_selection',
          brandId: 'brd_selection',
          merchantId: 'mer_selection',
          slug: 'selection',
          publicName: 'Selection',
          timezone: 'UTC',
          currency: 'USD',
          createdAt: now,
          updatedAt: now
        })
        yield* db.insert(shopAddresses).values({
          id: 'adr_selection',
          shopId: 'shp_selection',
          addressJson: JSON.stringify({
            line1: '21 Mercer Street',
            city: 'New York',
            state: 'NY',
            postalCode: '10013'
          }),
          latitude: '40.724',
          longitude: '-74.001',
          createdAt: now,
          updatedAt: now
        })
        yield* db.insert(providers).values({
          id: 'prv_one',
          merchantId: 'mer_selection',
          linkedUserId: 'usr_selection_owner',
          displayName: 'One',
          status: 'active',
          isDefault: true,
          createdAt: now,
          updatedAt: now
        })
        yield* db.insert(services).values([
          {
            id: 'svc_primary',
            merchantId: 'mer_selection',
            name: 'Primary',
            description: 'Primary service details.',
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
        yield* db.insert(shopProviders).values({
          shopId: 'shp_selection',
          providerId: 'prv_one',
          createdAt: now
        })
        yield* db.insert(shopServices).values([
          { shopId: 'shp_selection', serviceId: 'svc_primary', createdAt: now },
          { shopId: 'shp_selection', serviceId: 'svc_extra', createdAt: now }
        ])
      }),
      layerFromD1(test.d1)
    )
  )
}, 60_000)

afterAll(async () => test.dispose())

describe('Live Booking Selection', () => {
  it('atomically persists the sole Provider and ordered Services across layer recreation', async () => {
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
    const providerJourney = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(BookingSelection, (selection) => selection.load(issued.session)),
        selectionLayer
      )
    )
    const serviceJourney = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(BookingSelection, (selection) =>
          selection.chooseServices(
            issued.session,
            {
              primaryServiceId: 'svc_primary',
              additionalServiceIds: ['svc_extra']
            },
            providerJourney.version
          )
        ),
        selectionLayer
      )
    )
    const stale = await Effect.runPromise(
      Effect.provide(
        Effect.result(
          Effect.flatMap(BookingSelection, (selection) =>
            selection.chooseServices(
              issued.session,
              {
                primaryServiceId: 'svc_primary',
                additionalServiceIds: ['svc_extra']
              },
              providerJourney.version
            )
          )
        ),
        selectionLayer
      )
    )
    expect(serviceJourney.version).toBe(3)
    expect(stale).toMatchObject({
      _tag: 'Failure',
      failure: {
        _tag: 'BookingPartyConflict',
        bookingPartyId: expect.stringMatching(/^bpt_/),
        expectedVersion: 2
      }
    })

    const refreshedLayer = LiveBookingSelection.pipe(
      Layer.provide(layerFromD1(test.d1))
    )
    const refreshed = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(BookingSelection, (selection) => selection.load(issued.session)),
        refreshedLayer
      )
    )
    expect(refreshed.providerPreference).toEqual({
      kind: 'specific',
      providerId: 'prv_one'
    })
    expect(refreshed.version).toBe(3)
    expect(refreshed.selection).toEqual({
      primaryServiceId: 'svc_primary',
      additionalServiceIds: ['svc_extra']
    })
    expect(
      refreshed.services.find((service) => service.id === 'svc_primary')
    ).toMatchObject({ description: 'Primary service details.' })
    expect(refreshed.shops).toEqual([
      expect.objectContaining({
        addressLines: ['21 Mercer Street', 'New York, NY 10013'],
        coordinates: { latitude: 40.724, longitude: -74.001 }
      })
    ])
  }, 15_000)
})
