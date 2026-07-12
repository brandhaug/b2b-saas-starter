import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { testMerchantContext } from '@b2b-saas-starter/capabilities/merchant-catalog'
import { SeedShopTopology } from '@b2b-saas-starter/capabilities/merchant-catalog/testing'
import { SeedWalkIns } from '@b2b-saas-starter/capabilities/walk-ins/testing'
import {
  makeWalkInLifecycleRequestHandler,
  type WalkInLifecycleRunner
} from './walk-in-lifecycle-handler.ts'

const shop = {
  id: 'shp_owned',
  brandId: 'brd_one',
  merchantId: 'mer_one',
  slug: 'central',
  publicName: 'Central',
  timezone: 'Europe/Bucharest',
  currency: 'RON'
} as const
const entry = {
  id: 'wie_one',
  shopId: shop.id,
  status: 'waiting',
  position: 1
} as const
const layer = Layer.mergeAll(
  SeedShopTopology([shop]),
  SeedWalkIns({
    records: [entry],
    configurations: [
      {
        shopId: shop.id,
        open: true,
        eligibleServiceIds: ['svc_one'],
        eligibleProviderIds: [],
        averageServiceMinutes: 10,
        acknowledgmentTtlMinutes: 60,
        entryTtlMinutes: 240
      }
    ]
  }),
  testMerchantContext({
    id: 'mer_one',
    publicName: 'Merchant',
    slug: 'merchant',
    timezone: 'Europe/Bucharest',
    currency: 'RON',
    plan: 'solo'
  })
)
const run: WalkInLifecycleRunner = (_userId, effect) =>
  Effect.runPromise(Effect.provide(effect, layer))

describe('Merchant walk-in lifecycle boundary', () => {
  it('lists the owned queue and drives called through served', async () => {
    const requests = makeWalkInLifecycleRequestHandler({
      currentUserId: async () => 'usr_owner',
      run
    })
    expect(await requests.shops()).toEqual([shop])
    expect(await requests.queue(shop.id)).toHaveLength(1)
    expect(
      (await requests.transition({ shopId: shop.id, entryId: entry.id, to: 'called' }))
        .status
    ).toBe('called')
    expect(
      (await requests.transition({ shopId: shop.id, entryId: entry.id, to: 'serving' }))
        .status
    ).toBe('serving')
    expect(
      (await requests.transition({ shopId: shop.id, entryId: entry.id, to: 'served' }))
        .status
    ).toBe('served')
  })

  it('rejects access to a shop outside the authenticated merchant', async () => {
    const requests = makeWalkInLifecycleRequestHandler({
      currentUserId: async () => 'usr_owner',
      run
    })
    await expect(requests.queue('shp_other')).rejects.toMatchObject({
      _tag: 'ShopNotFound',
      slug: 'shp_other'
    })
  })
})
