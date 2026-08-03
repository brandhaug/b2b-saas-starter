import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  MerchantCatalog,
  MerchantContext,
  SeedMerchantCatalog,
  testMerchantContext,
  type MerchantIdentity,
  type SeedMerchantCatalogConfigurationStore
} from '@b2b-saas-starter/capabilities/merchant-catalog'
import { makeMerchantCatalogRequestHandler } from './merchant-catalog-handler.ts'

const solo: MerchantIdentity = {
  id: 'mer_solo_app',
  publicName: 'Solo App Studio',
  slug: 'solo-app-studio',
  timezone: 'Europe/Bucharest',
  currency: 'RON',
  plan: 'solo'
}

const makeHarness = () => {
  const store: SeedMerchantCatalogConfigurationStore = {
    services: new Map(),
    providers: new Map([
      [
        'prv_solo_default',
        {
          id: 'prv_solo_default',
          merchantId: solo.id,
          displayName: 'Solo Owner',
          status: 'active',
          isDefault: true
        }
      ]
    ]),
    eligibility: new Set()
  }
  const identities = new Map([['usr_solo', solo]])
  const run = <A, E>(
    userId: string,
    effect: Effect.Effect<A, E, MerchantCatalog | MerchantContext>
  ) =>
    Effect.runPromise(
      Effect.provide(
        effect,
        Layer.merge(
          SeedMerchantCatalog(store),
          testMerchantContext(identities.get(userId)!)
        )
      )
    )
  return {
    store,
    forUser: (userId: string) =>
      makeMerchantCatalogRequestHandler({
        currentUserId: async () => userId,
        run
      })
  }
}

describe('Merchant Catalog request handler', () => {
  it('runs the durable Details-to-Providers lifecycle through the resolved user', async () => {
    const harness = makeHarness()
    const requests = harness.forUser('usr_solo')
    const service = await requests.saveService({
      name: 'App Cut',
      description: null,
      category: 'Hair',
      priceMinor: 6000,
      currency: 'RON',
      durationMinutes: 45,
      status: 'active'
    })
    await requests.saveEligibility({
      serviceId: service.id,
      providerIds: ['prv_solo_default']
    })
    await requests.saveService({ ...service, status: 'inactive' })
    const snapshot = await requests.read()

    expect(snapshot.services[0]).toMatchObject({
      id: service.id,
      status: 'inactive',
      eligibleProviderIds: ['prv_solo_default']
    })
    expect(harness.store.services.has(service.id)).toBe(true)
  })

  it('surfaces validation and updates only the persisted Owner-Provider', async () => {
    const harness = makeHarness()
    const soloRequests = harness.forUser('usr_solo')

    await expect(
      soloRequests.saveService({
        name: 'Invalid',
        priceMinor: 0,
        currency: 'RON',
        durationMinutes: 30,
        status: 'active'
      })
    ).rejects.toMatchObject({ reason: 'invalid_price' })
    await expect(
      soloRequests.saveProvider({
        id: 'prv_missing',
        displayName: 'Hidden mutation'
      })
    ).rejects.toMatchObject({ reason: 'item_not_found' })
    expect(harness.store.services.size).toBe(0)
  })
})
