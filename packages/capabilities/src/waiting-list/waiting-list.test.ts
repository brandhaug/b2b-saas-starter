import { describe, expect, it } from 'vitest'
import { Effect, Layer } from 'effect'
import {
  AvailabilityOfferUnavailable,
  deriveOfferCandidates,
  emptySeedWaitingListStore,
  OfferBooking,
  PendingOfferExists,
  SeedWaitingList,
  WaitingList,
  type WaitingListShape
} from './waiting-list.ts'

const now = '2026-07-12T10:00:00.000Z'
const request = {
  serviceIds: ['svc_cut'],
  providerPreference: { kind: 'any' as const },
  from: '2026-07-13T08:00:00.000Z',
  until: '2026-07-20T18:00:00.000Z'
}
const customer = { name: 'Ada Lovelace', email: 'ada@example.com' }
const slot = {
  providerId: 'pro_1',
  startsAt: '2026-07-14T09:00:00.000Z',
  endsAt: '2026-07-14T09:30:00.000Z'
}

const setup = () => {
  const store = emptySeedWaitingListStore()
  let bookings = 0
  const booking = Layer.succeed(OfferBooking)({
    createSessionWithHold: () =>
      Effect.sync(() => ({
        bookingSessionId: `bsn_${++bookings}`,
        timeSlotHoldId: `hold_${bookings}`,
        routeId: `route_${bookings}`,
        capability: `session-secret-${bookings}`
      }))
  })
  const layer = SeedWaitingList(store).pipe(Layer.provide(booking))
  const run = <A, E>(effect: Effect.Effect<A, E, WaitingList>) =>
    Effect.runPromise(effect.pipe(Effect.provide(layer)))
  return { store, run, bookings: () => bookings }
}

const apply = (waitingList: WaitingListShape) =>
  waitingList.apply({
    id: 'wla_1',
    shopId: 'shop_1',
    request,
    customer,
    now,
    expiresAt: '2026-07-21T00:00:00.000Z'
  })
const offer = (waitingList: WaitingListShape, id = 'off_1', capability = 'secret') =>
  waitingList.offer({
    id,
    applicationId: 'wla_1',
    slot,
    capability,
    now,
    expiresAt: '2026-07-12T11:00:00.000Z'
  })

describe('Waiting List', () => {
  it('derives candidates deterministically within the requested window and provider preference', () => {
    expect(
      deriveOfferCandidates(
        {
          ...request,
          providerPreference: { kind: 'specific', providerId: 'pro_1' }
        },
        [
          { ...slot, providerId: 'pro_2' },
          {
            ...slot,
            startsAt: '2026-07-15T09:00:00.000Z',
            endsAt: '2026-07-15T09:30:00.000Z'
          },
          slot,
          {
            ...slot,
            startsAt: '2026-07-21T09:00:00.000Z',
            endsAt: '2026-07-21T09:30:00.000Z'
          }
        ]
      )
    ).toEqual([
      slot,
      {
        ...slot,
        startsAt: '2026-07-15T09:00:00.000Z',
        endsAt: '2026-07-15T09:30:00.000Z'
      }
    ])
  })

  it('captures preferences and permits sequential offers, never concurrent pending offers', async () => {
    const { run } = setup()
    await run(
      Effect.gen(function* () {
        const waitingList = yield* WaitingList
        const application = yield* apply(waitingList)
        expect(application.request).toEqual(request)
        yield* offer(waitingList)
        const duplicate = yield* Effect.flip(offer(waitingList, 'off_2'))
        expect(duplicate).toBeInstanceOf(PendingOfferExists)
        yield* waitingList.declineOffer('off_1', 'secret', '2026-07-12T10:05:00.000Z')
        const next = yield* offer(waitingList, 'off_2', 'secret-2')
        expect(next.status).toBe('pending')
      })
    )
  })

  it('uses a uniform response for incorrect, stale, and expired offer links', async () => {
    const { run } = setup()
    await run(
      Effect.gen(function* () {
        const waitingList = yield* WaitingList
        yield* apply(waitingList)
        yield* offer(waitingList)
        for (const [id, capability, at] of [
          ['missing', 'secret', now],
          ['off_1', 'wrong', now],
          ['off_1', 'secret', '2026-07-12T12:00:00.000Z']
        ] as const) {
          const error = yield* Effect.flip(waitingList.inspectOffer(id, capability, at))
          expect(error).toBeInstanceOf(AvailabilityOfferUnavailable)
        }
      })
    )
  })

  it('accepts into a purpose-bound session and hold, not an Appointment', async () => {
    const { run, store, bookings } = setup()
    const result = await run(
      Effect.gen(function* () {
        const waitingList = yield* WaitingList
        yield* apply(waitingList)
        yield* offer(waitingList)
        return yield* waitingList.acceptOffer(
          'off_1',
          'secret',
          '2026-07-12T10:10:00.000Z'
        )
      })
    )
    expect(result).toMatchObject({
      bookingSessionId: 'bsn_1',
      timeSlotHoldId: 'hold_1'
    })
    expect(result).not.toHaveProperty('appointmentId')
    expect(store.applications.get('wla_1')?.status).toBe('fulfilled')
    expect(store.offers.get('off_1')?.status).toBe('accepted')
    expect(bookings()).toBe(1)
  })

  it('does not consume the offer when bound session creation fails', async () => {
    const store = emptySeedWaitingListStore()
    const failedBooking = Layer.succeed(OfferBooking)({
      createSessionWithHold: () =>
        Effect.fail({
          _tag: 'CapabilityUnavailable',
          capability: 'booking',
          message: 'failed'
        } as never)
    })
    const layer = SeedWaitingList(store).pipe(Layer.provide(failedBooking))
    const effect = Effect.gen(function* () {
      const waitingList = yield* WaitingList
      yield* apply(waitingList)
      yield* offer(waitingList)
      yield* Effect.flip(
        waitingList.acceptOffer('off_1', 'secret', '2026-07-12T10:10:00.000Z')
      )
    }).pipe(Effect.provide(layer))
    await Effect.runPromise(effect)
    expect(store.applications.get('wla_1')?.status).toBe('active')
    expect(store.offers.get('off_1')?.status).toBe('pending')
  })

  it('expires offers and applications deterministically', async () => {
    const { run, store } = setup()
    const counts = await run(
      Effect.gen(function* () {
        const waitingList = yield* WaitingList
        yield* apply(waitingList)
        yield* offer(waitingList)
        return yield* waitingList.expire('2026-07-22T00:00:00.000Z')
      })
    )
    expect(counts).toEqual({ applications: 1, offers: 1 })
    expect(store.applications.get('wla_1')?.status).toBe('expired')
    expect(store.offers.get('off_1')?.status).toBe('expired')
  })
})
