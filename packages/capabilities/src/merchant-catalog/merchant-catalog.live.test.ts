import { Effect, Layer } from 'effect'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  Database,
  layerFromD1,
  merchants,
  providerServiceEligibility,
  providers,
  services,
  user
} from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { LiveMerchantOnboarding, MerchantOnboarding } from './merchant-onboarding.ts'
import { LiveMerchantCatalog, MerchantCatalog } from './merchant-catalog.ts'
import { liveMerchantContext, MerchantContext } from './merchant-context.ts'
import { LiveScheduling, Scheduling } from '../scheduling/scheduling.ts'

let test: TestD1

const runDb = <A, E>(effect: Effect.Effect<A, E, Database>) =>
  Effect.runPromise(Effect.provide(effect, layerFromD1(test.d1)))

const runCatalog = <A, E>(
  userId: string,
  effect: Effect.Effect<A, E, MerchantCatalog | MerchantContext>
) =>
  Effect.runPromise(
    Effect.provide(
      effect,
      Layer.merge(LiveMerchantCatalog, liveMerchantContext(userId)).pipe(
        Layer.provide(layerFromD1(test.d1))
      )
    )
  )

const runCatalogScheduling = <A, E>(
  userId: string,
  effect: Effect.Effect<A, E, MerchantCatalog | MerchantContext | Scheduling>
) =>
  Effect.runPromise(
    Effect.provide(
      effect,
      Layer.mergeAll(
        LiveMerchantCatalog,
        LiveScheduling,
        liveMerchantContext(userId)
      ).pipe(Layer.provide(layerFromD1(test.d1)))
    )
  )

beforeAll(async () => {
  test = await provisionTestD1()
  await runDb(
    Effect.gen(function* () {
      const db = yield* Database
      yield* db.insert(user).values([
        {
          id: 'usr_catalog_owner',
          email: 'catalog@merchant.test',
          name: 'Catalog Owner',
          emailVerified: true
        },
        {
          id: 'usr_catalog_other',
          email: 'other-catalog@merchant.test',
          name: 'Other Catalog Owner',
          emailVerified: true
        }
      ])
    })
  )
  const onboarding = LiveMerchantOnboarding.pipe(Layer.provide(layerFromD1(test.d1)))
  await Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const service = yield* MerchantOnboarding
        yield* service.complete('usr_catalog_owner', {
          publicName: 'Catalog Studio',
          slug: 'catalog-studio',
          timezone: 'Europe/Bucharest',
          currency: 'RON'
        })
        yield* service.complete('usr_catalog_other', {
          publicName: 'Other Catalog Studio',
          slug: 'other-catalog-studio',
          timezone: 'Europe/Bucharest',
          currency: 'RON'
        })
      }),
      onboarding
    )
  )
}, 60_000)

afterAll(async () => {
  await test.dispose()
})

describe('Live Merchant Catalog', () => {
  it('persists Services with automatic Owner-Provider eligibility', async () => {
    const snapshot = await runCatalog(
      'usr_catalog_owner',
      Effect.gen(function* () {
        const catalog = yield* MerchantCatalog
        const service = yield* catalog.createService({
          name: 'Live Cut',
          description: null,
          category: 'Hair',
          priceMinor: 6500,
          currency: 'RON',
          durationMinutes: 45,
          status: 'active'
        })
        const current = yield* catalog.read()
        const defaultProvider = current.providers.find((item) => item.isDefault)!
        yield* catalog.setServiceEligibility(service.id, [defaultProvider.id])
        yield* catalog.setServiceBuffers(service.id, {
          beforeBufferMinutes: 10,
          afterBufferMinutes: 15
        })
        return yield* catalog.read()
      })
    )

    expect(snapshot.services[0]?.eligibleProviderIds).toHaveLength(1)
    expect(snapshot.providers).toHaveLength(1)
    const persistedPairs = await runDb(
      Effect.gen(function* () {
        const db = yield* Database
        return yield* db.select().from(providerServiceEligibility)
      })
    )
    expect(persistedPairs).toHaveLength(1)
    expect(
      await test.d1
        .prepare(
          `SELECT kind,before_json,after_json FROM schedule_changes
           WHERE kind='service_buffers' LIMIT 1`
        )
        .first()
    ).toEqual({
      kind: 'service_buffers',
      before_json: 'null',
      after_json: JSON.stringify({
        beforeBufferMinutes: 10,
        afterBufferMinutes: 15
      })
    })

    const activeReplacementRejected = await runCatalog(
      'usr_catalog_owner',
      Effect.gen(function* () {
        const catalog = yield* MerchantCatalog
        return yield* Effect.flip(
          catalog.setServiceEligibility(snapshot.services[0]!.id, [])
        )
      })
    )
    expect(activeReplacementRejected).toMatchObject({
      _tag: 'MerchantCatalogInvalid',
      reason: 'active_service_requires_owner_eligibility'
    })

    const lifecycle = await runCatalog(
      'usr_catalog_owner',
      Effect.gen(function* () {
        const catalog = yield* MerchantCatalog
        const service = snapshot.services[0]!
        yield* catalog.updateService(service.id, { ...service, status: 'inactive' })
        yield* catalog.setServiceEligibility(service.id, [])
        return {
          all: yield* catalog.read(),
          bookable: yield* catalog.readBookable()
        }
      })
    )
    expect(lifecycle.all.services[0]?.status).toBe('inactive')
    expect(lifecycle.all.services[0]?.eligibleProviderIds).toEqual([])
    expect(lifecycle.bookable.services).toEqual([])

    const controls = await runCatalogScheduling(
      'usr_catalog_owner',
      Effect.flatMap(Scheduling, (scheduling) => scheduling.listControls())
    )
    expect(controls.recentChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'service_configuration',
          actorId: 'usr_catalog_owner'
        }),
        expect.objectContaining({
          kind: 'service_eligibility',
          actorId: 'usr_catalog_owner'
        })
      ])
    )
    const configurationChange = controls.recentChanges.find(
      (change) => change.kind === 'service_configuration'
    )!
    expect(JSON.parse(configurationChange.beforeJson)).toEqual({
      durationMinutes: 45,
      status: 'active'
    })
    expect(JSON.parse(configurationChange.afterJson)).toEqual({
      durationMinutes: 45,
      status: 'inactive'
    })
    const eligibilityChange = controls.recentChanges.find(
      (change) => change.kind === 'service_eligibility'
    )!
    expect(JSON.parse(eligibilityChange.beforeJson)).toEqual({
      providerIds: [snapshot.providers[0]!.id]
    })
    expect(JSON.parse(eligibilityChange.afterJson)).toEqual({ providerIds: [] })

    const reactivated = await runCatalog(
      'usr_catalog_owner',
      Effect.gen(function* () {
        const catalog = yield* MerchantCatalog
        const service = (yield* catalog.read()).services[0]!
        yield* catalog.updateService(service.id, { ...service, status: 'active' })
        return yield* catalog.read()
      })
    )
    expect(reactivated.services[0]?.eligibleProviderIds).toEqual([
      snapshot.providers[0]!.id
    ])
  })

  it('does not disclose or mutate another Merchant catalog item', async () => {
    const serviceId = await runCatalog(
      'usr_catalog_owner',
      Effect.map(MerchantCatalog, (catalog) => catalog.read()).pipe(Effect.flatten)
    ).then((snapshot) => snapshot.services[0]!.id)

    const result = await runCatalog(
      'usr_catalog_other',
      Effect.gen(function* () {
        const catalog = yield* MerchantCatalog
        const snapshot = yield* catalog.read()
        const denied = yield* Effect.flip(
          catalog.updateService(serviceId, {
            name: 'Stolen Service',
            priceMinor: 100,
            currency: 'RON',
            durationMinutes: 10,
            status: 'active'
          })
        )
        return { snapshot, denied }
      })
    )

    expect(result.snapshot.services).toEqual([])
    expect(result.denied.reason).toBe('item_not_found')
  })

  it('enforces merchant-consistent eligibility in real D1', async () => {
    const graph = await runDb(
      Effect.gen(function* () {
        const db = yield* Database
        const ownerMerchant = (yield* db
          .select()
          .from(merchants)
          .where(eq(merchants.slug, 'catalog-studio')))[0]!
        const otherMerchant = (yield* db
          .select()
          .from(merchants)
          .where(eq(merchants.slug, 'other-catalog-studio')))[0]!
        const ownerService = (yield* db
          .select()
          .from(services)
          .where(eq(services.merchantId, ownerMerchant.id)))[0]!
        const otherProvider = (yield* db
          .select()
          .from(providers)
          .where(eq(providers.merchantId, otherMerchant.id)))[0]!
        return { ownerMerchant, ownerService, otherProvider }
      })
    )

    await expect(
      test.d1
        .prepare(
          `INSERT INTO provider_service_eligibility
           (merchant_id, provider_id, service_id, created_at)
           VALUES (?, ?, ?, ?)`
        )
        .bind(
          graph.ownerMerchant.id,
          graph.otherProvider.id,
          graph.ownerService.id,
          new Date().toISOString()
        )
        .run()
    ).rejects.toThrow(/within one merchant|Merchant-scoped/)
  })
})
