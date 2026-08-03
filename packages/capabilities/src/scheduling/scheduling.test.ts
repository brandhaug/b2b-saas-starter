import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  buildSeedBookingScenario,
  deriveIncompleteSeedBookingScenario,
  type SeedBookingScenario
} from '../merchant-catalog/merchant-onboarding.ts'
import { testMerchantContext } from '../merchant-catalog/merchant-context.ts'
import type { MerchantContext } from '../merchant-catalog/merchant-context.ts'
import {
  BookingPublication,
  emptySeedSchedulingStore,
  Scheduling,
  SeedBookingPublication,
  SeedScheduling
} from './scheduling.ts'
import { civilTimeInstants, deriveControlledAvailability } from './scheduling.ts'

const scenario = buildSeedBookingScenario('2026-07-10T09:30:00.000Z')

const runWith = <A, E>(
  fixture: SeedBookingScenario,
  effect: Effect.Effect<A, E, Scheduling | BookingPublication | MerchantContext>
) => {
  const store = emptySeedSchedulingStore(fixture)
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(SeedScheduling(store)),
      Effect.provide(SeedBookingPublication(store)),
      Effect.provide(testMerchantContext(fixture.merchant))
    )
  )
}

const run = <A, E>(
  effect: Effect.Effect<A, E, Scheduling | BookingPublication | MerchantContext>
) => runWith(scenario, effect)

describe('Scheduling and Public Booking Page', () => {
  it('publishes an in-scope Merchant-first Booking App path', async () => {
    const page = await run(
      Effect.flatMap(BookingPublication, (publication) =>
        publication.resolvePublished(scenario.merchant.slug)
      )
    )

    expect(page.bookingPath).toBe('/mara-booking-studio/booking')
  })

  it('derives deterministic future Availability from recurring rules', async () => {
    const result = await run(
      Effect.gen(function* () {
        const scheduling = yield* Scheduling
        yield* scheduling.saveProviderRules(scenario.provider.id, [
          { weekday: 1, startTime: '09:00', endTime: '11:00' }
        ])
        return yield* scheduling.availability({
          providerId: scenario.provider.id,
          serviceId: scenario.services[1]!.id,
          from: '2026-07-10T09:30:00.000Z',
          days: 7
        })
      })
    )

    expect(result.slots.map((slot) => slot.startsAt)).toEqual([
      '2026-07-13T06:00:00.000Z',
      '2026-07-13T06:30:00.000Z',
      '2026-07-13T07:00:00.000Z',
      '2026-07-13T07:30:00.000Z'
    ])
  })

  it('removes slots that overlap an existing provider appointment', async () => {
    const result = await run(
      Effect.gen(function* () {
        const scheduling = yield* Scheduling
        yield* scheduling.saveProviderRules(scenario.provider.id, [
          { weekday: 1, startTime: '12:00', endTime: '14:00' }
        ])
        return yield* scheduling.availability({
          providerId: scenario.provider.id,
          serviceId: scenario.services[1]!.id,
          from: '2026-07-13T00:00:00.000Z',
          days: 1
        })
      })
    )

    expect(result.slots.map((slot) => slot.startsAt)).toEqual([
      '2026-07-13T09:00:00.000Z',
      '2026-07-13T10:30:00.000Z'
    ])
  })

  it('publishes only when readiness is complete and unpublishes without deleting rules', async () => {
    const result = await run(
      Effect.gen(function* () {
        const scheduling = yield* Scheduling
        const publication = yield* BookingPublication
        yield* scheduling.saveProviderRules(scenario.provider.id, [
          { weekday: 1, startTime: '09:00', endTime: '17:00' }
        ])
        const readiness = yield* publication.readiness()
        const published = yield* publication.publish()
        yield* publication.unpublish()
        return {
          readiness,
          published,
          rules: yield* scheduling.listProviderRules(scenario.provider.id)
        }
      })
    )

    expect(result.readiness).toEqual({ ready: true, incomplete: [] })
    expect(result.published.status).toBe('published')
    expect(result.rules).toHaveLength(1)
  })

  it('rejects publication with typed incomplete prerequisites', async () => {
    const incomplete = deriveIncompleteSeedBookingScenario(scenario)
    const failure = await runWith(
      incomplete,
      Effect.flatMap(BookingPublication, (publication) =>
        Effect.flip(publication.publish())
      )
    )
    expect(failure._tag).toBe('PublicationNotReady')
    if (failure._tag !== 'PublicationNotReady') throw failure
    expect(failure.incomplete).toContain('active-service')
  })

  it('iterates Merchant-local calendar dates across daylight-saving changes', async () => {
    const result = await run(
      Effect.gen(function* () {
        const scheduling = yield* Scheduling
        yield* scheduling.saveProviderRules(scenario.provider.id, [
          { weekday: 0, startTime: '09:00', endTime: '11:00' }
        ])
        return yield* scheduling.availability({
          providerId: scenario.provider.id,
          serviceId: scenario.services[1]!.id,
          from: '2026-10-24T20:00:00.000Z',
          days: 3
        })
      })
    )
    expect(result.slots.map((slot) => slot.startsAt)).toEqual([
      '2026-10-25T07:00:00.000Z',
      '2026-10-25T07:30:00.000Z',
      '2026-10-25T08:00:00.000Z',
      '2026-10-25T08:30:00.000Z'
    ])
  })

  it('omits DST gaps and exposes both instants in a fold', () => {
    expect(civilTimeInstants('2026-03-29', '03:30', 'Europe/Bucharest')).toEqual([])
    expect(
      civilTimeInstants('2026-10-25', '03:30', 'Europe/Bucharest').map((date) =>
        date.toISOString()
      )
    ).toEqual(['2026-10-25T00:30:00.000Z', '2026-10-25T01:30:00.000Z'])
  })

  it('applies overrides, blocks, buffers, notice, horizon and a start grid', () => {
    const result = deriveControlledAvailability({
      rules: [
        {
          id: 'mon',
          providerId: 'prv',
          weekday: 1,
          startTime: '09:00',
          endTime: '11:00'
        }
      ],
      timezone: 'Europe/Bucharest',
      serviceDurationMinutes: 30,
      now: '2026-07-12T20:00:00.000Z',
      controls: {
        startTimeIntervalMinutes: 15,
        minimumNoticeMinutes: 600,
        bookingHorizonDays: 1,
        beforeBufferMinutes: 15,
        afterBufferMinutes: 15,
        blocked: [
          { startsAt: '2026-07-13T06:35:00.000Z', endsAt: '2026-07-13T06:50:00.000Z' }
        ]
      }
    })
    expect(result.slots.map((slot) => slot.startsAt)).toEqual([
      '2026-07-13T07:15:00.000Z'
    ])
  })
})
