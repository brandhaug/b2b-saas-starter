import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  MerchantCatalog,
  SeedMerchantCatalogConfiguration,
  type SeedMerchantCatalogConfigurationStore
} from './merchant-catalog.ts'
import { MerchantContext, testMerchantContext } from './merchant-context.ts'

const merchant = {
  id: 'mer_team',
  publicName: 'Team Studio',
  slug: 'team-studio',
  timezone: 'Europe/Bucharest',
  currency: 'RON',
  plan: 'team'
} as const

const otherMerchant = { ...merchant, id: 'mer_other', slug: 'other-studio' } as const

const makeStore = (): SeedMerchantCatalogConfigurationStore => ({
  services: new Map(),
  providers: new Map([
    [
      'prv_default',
      {
        id: 'prv_default',
        merchantId: merchant.id,
        displayName: 'Mara Ionescu',
        status: 'active',
        isDefault: true
      }
    ],
    [
      'prv_other',
      {
        id: 'prv_other',
        merchantId: otherMerchant.id,
        displayName: 'Other Provider',
        status: 'active',
        isDefault: true
      }
    ]
  ]),
  eligibility: new Set()
})

const run = <A, E>(
  store: SeedMerchantCatalogConfigurationStore,
  effect: Effect.Effect<A, E, MerchantCatalog | MerchantContext>
) =>
  Effect.runPromise(
    Effect.provide(
      effect,
      Layer.merge(
        SeedMerchantCatalogConfiguration(store),
        testMerchantContext(merchant)
      )
    )
  )

describe('Merchant Catalog seed adapter', () => {
  it('creates a validated Service and assigns explicit Provider eligibility', async () => {
    const store = makeStore()
    const result = await run(
      store,
      Effect.gen(function* () {
        const catalog = yield* MerchantCatalog
        const service = yield* catalog.createService({
          name: 'Signature Cut',
          description: 'A precise consultation and cut.',
          category: 'Hair',
          priceMinor: 9000,
          currency: 'RON',
          durationMinutes: 60,
          status: 'active'
        })
        yield* catalog.setServiceEligibility(service.id, ['prv_default'])
        return yield* catalog.read()
      })
    )

    expect(result.services).toHaveLength(1)
    expect(result.services[0]).toMatchObject({
      name: 'Signature Cut',
      description: 'A precise consultation and cut.',
      category: 'Hair',
      priceMinor: 9000,
      currency: 'RON',
      durationMinutes: 60,
      status: 'active',
      eligibleProviderIds: ['prv_default']
    })
    expect([...store.eligibility]).toHaveLength(1)
  })

  it('rejects invalid Service values without a partial mutation', async () => {
    const store = makeStore()
    const reasons = await run(
      store,
      Effect.gen(function* () {
        const catalog = yield* MerchantCatalog
        const price = yield* Effect.flip(
          catalog.createService({
            name: 'Cut',
            priceMinor: 0,
            currency: 'RON',
            durationMinutes: 30,
            status: 'active'
          })
        )
        const duration = yield* Effect.flip(
          catalog.createService({
            name: 'Cut',
            priceMinor: 100,
            currency: 'RON',
            durationMinutes: -1,
            status: 'active'
          })
        )
        const currency = yield* Effect.flip(
          catalog.createService({
            name: 'Cut',
            priceMinor: 100,
            currency: 'ZZZ',
            durationMinutes: 30,
            status: 'active'
          })
        )
        return [price.reason, duration.reason, currency.reason]
      })
    )

    expect(reasons).toEqual(['invalid_price', 'invalid_duration', 'invalid_currency'])
    expect(store.services.size).toBe(0)
  })

  it('keeps tenant reads and eligibility mutations merchant-scoped', async () => {
    const store = makeStore()
    store.services.set('svc_other', {
      id: 'svc_other',
      merchantId: otherMerchant.id,
      name: 'Other Service',
      description: null,
      category: null,
      priceMinor: 1000,
      currency: 'RON',
      durationMinutes: 30,
      status: 'active'
    })

    const result = await run(
      store,
      Effect.gen(function* () {
        const catalog = yield* MerchantCatalog
        const snapshot = yield* catalog.read()
        const denied = yield* Effect.flip(
          catalog.setServiceEligibility('svc_other', ['prv_default'])
        )
        return { snapshot, denied }
      })
    )

    expect(result.snapshot.services).toEqual([])
    expect(result.snapshot.providers.map((provider) => provider.id)).toEqual([
      'prv_default'
    ])
    expect(result.denied.reason).toBe('item_not_found')
  })

  it('preserves inactive records while excluding them from bookable options', async () => {
    const store = makeStore()
    const result = await run(
      store,
      Effect.gen(function* () {
        const catalog = yield* MerchantCatalog
        const service = yield* catalog.createService({
          name: 'Historic Cut',
          priceMinor: 4000,
          currency: 'RON',
          durationMinutes: 30,
          status: 'active'
        })
        yield* catalog.setServiceEligibility(service.id, ['prv_default'])
        yield* catalog.updateService(service.id, { ...service, status: 'inactive' })
        return {
          snapshot: yield* catalog.read(),
          bookable: yield* catalog.readBookable()
        }
      })
    )

    expect(result.snapshot.services[0]?.status).toBe('inactive')
    expect(result.bookable.services).toEqual([])
    expect(store.services.has(result.snapshot.services[0]!.id)).toBe(true)
  })

  it('allows Team Provider management and requires one persisted default', async () => {
    const store = makeStore()
    const result = await run(
      store,
      Effect.gen(function* () {
        const catalog = yield* MerchantCatalog
        const provider = yield* catalog.createProvider({
          displayName: 'Radu Pop',
          isDefault: false,
          status: 'active'
        })
        const promoted = yield* catalog.updateProvider(provider.id, {
          ...provider,
          isDefault: true
        })
        return { promoted, snapshot: yield* catalog.read() }
      })
    )

    expect(result.promoted.isDefault).toBe(true)
    expect(result.snapshot.providers.filter((provider) => provider.isDefault)).toEqual([
      result.promoted
    ])
  })

  it('hides Provider administration for Solo while retaining its default Provider', async () => {
    const store = makeStore()
    const solo = { ...merchant, plan: 'solo' as const }
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const catalog = yield* MerchantCatalog
          const snapshot = yield* catalog.read()
          const denied = yield* Effect.flip(
            catalog.createProvider({
              displayName: 'Should Not Exist',
              isDefault: false,
              status: 'active'
            })
          )
          return { snapshot, denied }
        }),
        Layer.merge(SeedMerchantCatalogConfiguration(store), testMerchantContext(solo))
      )
    )

    expect(result.snapshot.presentation).toBe('solo')
    expect(result.snapshot.providers).toHaveLength(1)
    expect(result.denied.reason).toBe('team_required')
  })
})
