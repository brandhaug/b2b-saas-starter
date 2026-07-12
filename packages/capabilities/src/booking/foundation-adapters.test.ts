import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { SeedBookingParties } from './foundation-adapters.ts'
import { BookingParties, type BookingParty } from './foundations.ts'

const initial: BookingParty = {
  id: 'bpt_group',
  bookingSessionId: 'bsn_group',
  shopId: 'shp_one',
  lifecycle: 'active',
  currency: 'RON',
  locale: 'en',
  version: 1,
  requests: [
    {
      id: 'brq_coordinator',
      bookingPartyId: 'bpt_group',
      position: 0,
      providerPreference: 'specific',
      providerId: 'prv_one',
      primaryServiceId: null,
      serviceIds: [],
      holdId: 'hld_one',
      customerAccountId: null,
      customerDetails: { name: 'Coordinator', email: 'c@example.com', phone: null },
      startsAt: '2026-07-13T09:00:00.000Z',
      endsAt: '2026-07-13T09:30:00.000Z'
    }
  ]
}

describe('Booking Parties', () => {
  it('adds, reorders, and removes guests without replacing the solo request identity', async () => {
    const layer = SeedBookingParties([initial])
    const run = <A, E>(effect: Effect.Effect<A, E, BookingParties>) =>
      Effect.runPromise(Effect.provide(effect, layer))
    const added = await run(
      Effect.flatMap(BookingParties, (parties) =>
        parties.addRequest(initial.id, 1, '2026-07-12T10:00:00.000Z')
      )
    )
    expect(added.requests[0]?.id).toBe('brq_coordinator')
    const guestId = added.requests[1]!.id
    const reordered = await run(
      Effect.flatMap(BookingParties, (parties) =>
        parties.reorderRequests(
          initial.id,
          [guestId, 'brq_coordinator'],
          2,
          '2026-07-12T10:01:00.000Z'
        )
      )
    )
    expect(reordered.requests.map(({ id, position }) => ({ id, position }))).toEqual([
      { id: guestId, position: 0 },
      { id: 'brq_coordinator', position: 1 }
    ])
    const removed = await run(
      Effect.flatMap(BookingParties, (parties) =>
        parties.removeRequest(initial.id, guestId, 3, '2026-07-12T10:02:00.000Z')
      )
    )
    expect(removed.requests).toHaveLength(1)
    expect(removed.requests[0]).toMatchObject({ id: 'brq_coordinator', position: 0 })
  })

  it('clears only dependent interval facts after a material selection change', async () => {
    const layer = SeedBookingParties([initial])
    const updated = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(BookingParties, (parties) =>
          parties.updateRequest(
            initial.id,
            'brq_coordinator',
            { providerPreference: 'any', providerId: null },
            1,
            '2026-07-12T10:00:00.000Z'
          )
        ),
        layer
      )
    )
    expect(updated.requests[0]).toMatchObject({
      providerPreference: 'any',
      providerId: null,
      primaryServiceId: null,
      serviceIds: [],
      holdId: null,
      startsAt: null,
      endsAt: null,
      customerDetails: { name: 'Coordinator' }
    })
  })

  it('keeps the version unchanged when a request identity is missing', async () => {
    const layer = SeedBookingParties([initial])
    const unchanged = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(BookingParties, (parties) =>
          parties.updateRequest(
            initial.id,
            'brq_missing',
            { customerDetails: null },
            1,
            '2026-07-12T10:00:00.000Z'
          )
        ),
        layer
      )
    )
    expect(unchanged.version).toBe(1)
  })
})
