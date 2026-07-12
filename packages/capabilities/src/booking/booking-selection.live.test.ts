import { Effect, Layer } from 'effect'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  brands,
  bookingParties,
  Database,
  layerFromD1,
  merchants,
  providers,
  providerServiceEligibility,
  publicBookingPages,
  services,
  shopProviders,
  shopServices,
  shops
} from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { BookingSessions, LiveBookingSessions } from './booking-sessions.ts'
import { BookingSelection, LiveBookingSelection } from './booking-selection.ts'
import { hashSha256 } from '../internal/crypto.ts'

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
        yield* db.insert(shopProviders).values([
          { shopId: 'shp_selection', providerId: 'prv_one', createdAt: now },
          { shopId: 'shp_selection', providerId: 'prv_two', createdAt: now }
        ])
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
    const providerJourney = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(BookingSelection, (selection) =>
          selection.chooseProvider(issued.session, { kind: 'any' }, 1)
        ),
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
            selection.chooseProvider(issued.session, { kind: 'any' }, 2)
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
    expect(refreshed.providerPreference).toEqual({ kind: 'any' })
    expect(refreshed.version).toBe(3)
    expect(refreshed.selection).toEqual({
      primaryServiceId: 'svc_primary',
      additionalServiceIds: ['svc_extra']
    })

    const verifierHash = await hashSha256('2468')
    await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(Database, (db) =>
          db
            .update(providers)
            .set({
              bookingAccess: 'restricted',
              bookingAccessVerifierHash: verifierHash
            })
            .where(eq(providers.id, 'prv_one'))
        ),
        layerFromD1(test.d1)
      )
    )
    const proof = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(BookingSelection, (selection) =>
          selection.verifyProviderAccess(
            issued.session,
            'prv_one',
            '2468',
            new Date().toISOString()
          )
        ),
        refreshedLayer
      )
    )
    const restricted = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(BookingSelection, (selection) =>
          selection.chooseProvider(
            issued.session,
            { kind: 'specific', providerId: 'prv_one' },
            refreshed.version,
            proof.proof
          )
        ),
        refreshedLayer
      )
    )
    expect(restricted.providerPreference).toEqual({
      kind: 'specific',
      providerId: 'prv_one'
    })
    const expired = await Effect.runPromise(
      Effect.provide(
        Effect.result(
          Effect.flatMap(BookingSelection, (selection) =>
            selection.chooseProvider(
              issued.session,
              { kind: 'specific', providerId: 'prv_one' },
              restricted.version,
              proof.proof,
              proof.expiresAt
            )
          )
        ),
        refreshedLayer
      )
    )
    expect(expired).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'BookingSelectionRejected' }
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
    await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(Database, (db) =>
          db
            .update(bookingParties)
            .set({ lifecycle: 'confirming' })
            .where(eq(bookingParties.bookingSessionId, issued.session.id))
        ),
        layerFromD1(test.d1)
      )
    )
    const terminal = await Effect.runPromise(
      Effect.provide(
        Effect.result(
          Effect.flatMap(BookingSelection, (selection) =>
            selection.chooseProvider(
              issued.session,
              { kind: 'specific', providerId: 'prv_two' },
              normalized.version
            )
          )
        ),
        refreshedLayer
      )
    )
    expect(terminal).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'BookingSelectionRejected' }
    })
  })
})
