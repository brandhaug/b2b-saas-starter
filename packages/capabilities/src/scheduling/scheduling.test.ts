import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { buildSeedBookingScenario } from '../merchant-catalog/merchant-onboarding.ts'
import { testMerchantContext } from '../merchant-catalog/merchant-context.ts'
import type { MerchantContext } from '../merchant-catalog/merchant-context.ts'
import {
  BookingPublication,
  emptySeedSchedulingStore,
  Scheduling,
  SeedBookingPublication,
  SeedScheduling
} from './scheduling.ts'

const scenario = buildSeedBookingScenario('2026-07-10T09:30:00.000Z')

const run = <A, E>(
  effect: Effect.Effect<A, E, Scheduling | BookingPublication | MerchantContext>
) => {
  const store = emptySeedSchedulingStore(scenario)
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(SeedScheduling(store)),
      Effect.provide(SeedBookingPublication(store)),
      Effect.provide(testMerchantContext(scenario.merchant))
    )
  )
}

describe('Scheduling and Public Booking Page', () => {
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
})
