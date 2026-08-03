import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  buildSeedBookingScenario,
  SeedMerchantCatalog,
  seedEligibilityKey,
  testMerchantContext,
  type SeedMerchantCatalogConfigurationStore
} from '@b2b-saas-starter/capabilities/merchant-catalog'
import {
  emptySeedSchedulingStore,
  SeedMerchantActivation,
  SeedBookingPublication,
  SeedScheduling
} from '@b2b-saas-starter/capabilities/scheduling'
import {
  makeSchedulingRequestHandler,
  type SchedulingRunner
} from './scheduling-handler.ts'

const scenario = buildSeedBookingScenario('2026-07-10T09:30:00.000Z')

describe('Merchant scheduling request boundary', () => {
  it('reads fixed-clock Availability and persists multiple weekly intervals', async () => {
    const schedulingStore = emptySeedSchedulingStore(scenario)
    const catalogStore: SeedMerchantCatalogConfigurationStore = {
      services: new Map(scenario.services.map((service) => [service.id, service])),
      providers: new Map(scenario.providers.map((provider) => [provider.id, provider])),
      eligibility: new Set(scenario.eligibility.map(seedEligibilityKey))
    }
    const layer = Layer.mergeAll(
      SeedMerchantCatalog(catalogStore),
      SeedScheduling(schedulingStore),
      SeedBookingPublication(schedulingStore),
      SeedMerchantActivation,
      testMerchantContext(scenario.merchant)
    )
    const run: SchedulingRunner = (_userId, effect) =>
      Effect.runPromise(Effect.provide(effect, layer))
    const requests = makeSchedulingRequestHandler({
      currentUserId: async () => scenario.owner.id,
      run,
      now: () => '2026-07-10T09:30:00.000Z'
    })

    await requests.saveRules({
      providerId: scenario.provider.id,
      rules: [
        { weekday: 1, startTime: '09:00', endTime: '12:00' },
        { weekday: 1, startTime: '13:00', endTime: '17:00' }
      ]
    })
    const result = await requests.read()

    expect(result.rules[scenario.provider.id]).toHaveLength(2)
    expect(result.availability?.slots[0]?.startsAt).toBe('2026-07-13T06:00:00.000Z')
    const appointmentAvailability = await requests.availability({
      providerId: scenario.provider.id,
      serviceId: scenario.services[0]!.id,
      from: '2026-07-13T00:00:00.000Z',
      days: 1
    })
    expect(appointmentAvailability.slots.length).toBeGreaterThan(0)
    await requests.setPublished(false)
    expect((await requests.read()).publication.status).toBe('unpublished')
  })
})
