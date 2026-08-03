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
  shops
} from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { LiveBookingParties } from './foundation-adapters.ts'
import { BookingParties } from './foundations.ts'

let test: TestD1
const now = '2026-07-12T10:00:00.000Z'

beforeAll(async () => {
  test = await provisionTestD1()
  await Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const db = yield* Database
        yield* db.insert(merchants).values({
          id: 'mer_group',
          publicName: 'Group',
          slug: 'group',
          timezone: 'UTC',
          currency: 'EUR',
          createdAt: now,
          updatedAt: now
        })
        yield* db.insert(brands).values({
          id: 'brd_group',
          merchantId: 'mer_group',
          name: 'Group',
          createdAt: now,
          updatedAt: now
        })
        yield* db.insert(shops).values({
          id: 'shp_group',
          brandId: 'brd_group',
          merchantId: 'mer_group',
          slug: 'group',
          publicName: 'Group',
          timezone: 'UTC',
          currency: 'EUR',
          createdAt: now,
          updatedAt: now
        })
        yield* db.insert(bookingSessions).values({
          id: 'bsn_group',
          merchantId: 'mer_group',
          capabilityHash: 'hash',
          checkoutPath: 'pay_in_person',
          lifecycle: 'active',
          createdAt: now,
          lastActivityAt: now,
          idleExpiresAt: '2026-07-12T10:30:00.000Z',
          absoluteExpiresAt: '2026-07-12T12:00:00.000Z'
        })
        yield* db.insert(bookingParties).values({
          id: 'bpt_group',
          bookingSessionId: 'bsn_group',
          shopId: 'shp_group',
          activeRequestId: 'brq_original',
          currency: 'EUR',
          createdAt: now,
          updatedAt: now
        })
        yield* db.insert(bookingRequests).values({
          id: 'brq_original',
          bookingPartyId: 'bpt_group',
          position: 0,
          createdAt: now,
          updatedAt: now
        })
      }),
      layerFromD1(test.d1)
    )
  )
}, 60_000)

afterAll(async () => test.dispose())

describe('Live Booking Parties', () => {
  it('persists an ordered composite party and rejects a stale mutation', async () => {
    const layer = LiveBookingParties.pipe(Layer.provide(layerFromD1(test.d1)))
    const attempt = () =>
      Effect.runPromise(
        Effect.provide(
          Effect.result(
            Effect.flatMap(BookingParties, (parties) =>
              parties.addRequest('bpt_group', 1, now)
            )
          ),
          layer
        )
      )
    const attempts = await Promise.all([attempt(), attempt()])
    expect(attempts.filter((result) => result._tag === 'Success')).toHaveLength(1)
    expect(attempts.filter((result) => result._tag === 'Failure')).toHaveLength(1)
    const added = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(BookingParties, (parties) => parties.findById('bpt_group')),
        layer
      )
    )
    expect(added.requests.map((request) => request.id)).toEqual([
      'brq_original',
      expect.stringMatching(/^brq_/)
    ])
    const stale = attempts.find((result) => result._tag === 'Failure')!
    expect(stale).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'BookingPartyConflict', expectedVersion: 1 }
    })
    const secondId = added.requests[1]!.id
    const activated = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(BookingParties, (parties) =>
          parties.activateRequest('bpt_group', secondId, 2, now)
        ),
        layer
      )
    )
    expect(activated.activeRequestId).toBe(secondId)
    const providerOverride = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(BookingParties, (parties) =>
          parties.updateRequest(
            'bpt_group',
            secondId,
            { providerPreference: 'any', providerId: 'prv_attacker' },
            activated.version,
            now
          )
        ),
        layer
      )
    )
    expect(providerOverride.version).toBe(activated.version)
    expect(providerOverride.requests[1]).toMatchObject({
      providerPreference: null,
      providerId: null
    })
  })
})
