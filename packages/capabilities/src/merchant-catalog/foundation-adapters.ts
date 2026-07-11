import { Effect, Layer } from 'effect'
import { eq } from 'drizzle-orm'
import { Database, shops } from '@b2b-saas-starter/db'
import { orUnavailable } from '../internal/unavailable.ts'
import { ShopNotFound, ShopTopology, type Shop } from './foundations.ts'

export const SeedShopTopology = (records: readonly Shop[]): Layer.Layer<ShopTopology> =>
  Layer.succeed(ShopTopology)({
    findBySlug: (slug) => {
      const shop = records.find((candidate) => candidate.slug === slug)
      return shop ? Effect.succeed(shop) : Effect.fail(new ShopNotFound({ slug }))
    }
  })

export const LiveShopTopology: Layer.Layer<ShopTopology, never, Database> =
  Layer.effect(
    ShopTopology,
    Effect.gen(function* () {
      const db = yield* Database
      return {
        findBySlug: (slug) =>
          Effect.flatMap(
            orUnavailable('shop-topology')(
              db.select().from(shops).where(eq(shops.slug, slug)).limit(1)
            ),
            ([shop]) =>
              shop
                ? Effect.succeed({
                    id: shop.id,
                    brandId: shop.brandId,
                    merchantId: shop.merchantId,
                    slug: shop.slug,
                    publicName: shop.publicName,
                    timezone: shop.timezone,
                    currency: shop.currency
                  })
                : Effect.fail(new ShopNotFound({ slug }))
          )
      }
    })
  )
