import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { layerFromD1 } from '@b2b-saas-starter/db'
import { brands, merchants, shops } from '@b2b-saas-starter/db/schema'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { Database } from '@b2b-saas-starter/db/service'
import { LiveShopTopology, SeedShopTopology } from './foundation-adapters.ts'
import { ShopTopology } from './foundations.ts'

let test: TestD1
const now = '2026-07-11T12:00:00.000Z'
const expected = {
  id: 'shp_foundation',
  brandId: 'brd_foundation',
  merchantId: 'mrc_foundation',
  slug: 'foundation-shop',
  publicName: 'Foundation Shop',
  timezone: 'Europe/Bucharest',
  currency: 'RON'
} as const

beforeAll(async () => {
  test = await provisionTestD1()
  await Effect.runPromise(
    Effect.provide(
      Effect.gen(function* () {
        const db = yield* Database
        yield* db.insert(merchants).values({
          id: expected.merchantId,
          publicName: expected.publicName,
          slug: expected.slug,
          timezone: expected.timezone,
          currency: expected.currency,
          createdAt: now,
          updatedAt: now
        })
        yield* db.insert(brands).values({
          id: expected.brandId,
          merchantId: expected.merchantId,
          name: expected.publicName,
          createdAt: now,
          updatedAt: now
        })
        yield* db.insert(shops).values({ ...expected, createdAt: now, updatedAt: now })
      }),
      layerFromD1(test.d1)
    )
  )
}, 60_000)
afterAll(async () => test.dispose())

const read = (layer: Layer.Layer<ShopTopology>) =>
  Effect.runPromise(
    Effect.provide(
      Effect.flatMap(ShopTopology, (topology) => topology.findBySlug(expected.slug)),
      layer
    )
  )

describe('ShopTopology contract', () => {
  it('returns the same public result from Seed and Live adapters', async () => {
    const seed = await read(SeedShopTopology([expected]))
    const live = await read(LiveShopTopology.pipe(Layer.provide(layerFromD1(test.d1))))
    expect(live).toEqual(seed)
  })

  it('returns the same typed not-found result from Seed and Live adapters', async () => {
    const missingSlug = 'missing-shop'
    const findMissing = (layer: Layer.Layer<ShopTopology>) =>
      Effect.runPromise(
        Effect.provide(
          Effect.result(
            Effect.flatMap(ShopTopology, (topology) => topology.findBySlug(missingSlug))
          ),
          layer
        )
      )
    const seed = await findMissing(SeedShopTopology([expected]))
    const live = await findMissing(
      LiveShopTopology.pipe(Layer.provide(layerFromD1(test.d1)))
    )
    expect(live).toEqual(seed)
    expect(live._tag).toBe('Failure')
  })
})
