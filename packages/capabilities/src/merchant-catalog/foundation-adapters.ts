import { Effect, Layer } from 'effect'
import { and, eq } from 'drizzle-orm'
import { Database, merchants, shops } from '@b2b-saas-starter/db'
import { orUnavailable } from '../internal/unavailable.ts'
import { ShopNotFound, ShopTopology, type Shop } from './foundations.ts'

export const SeedShopTopology = (records: readonly Shop[]): Layer.Layer<ShopTopology> =>
  Layer.succeed(ShopTopology)({
    listAll: () => Effect.succeed(records),
    findByBookingPath: ({ merchantSlug, shopSlug }) => {
      const shop = records.find(
        (candidate) =>
          candidate.slug === shopSlug && candidate.merchantId === merchantSlug
      )
      return shop
        ? Effect.succeed(shop)
        : Effect.fail(new ShopNotFound({ slug: shopSlug }))
    },
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
        listAll: () =>
          Effect.map(orUnavailable('shop-topology')(db.select().from(shops)), (rows) =>
            rows.map((shop) => ({
              id: shop.id,
              brandId: shop.brandId,
              merchantId: shop.merchantId,
              slug: shop.slug,
              publicName: shop.publicName,
              timezone: shop.timezone,
              currency: shop.currency
            }))
          ),
        findByBookingPath: ({ merchantSlug, shopSlug }) =>
          Effect.flatMap(
            orUnavailable('shop-topology')(
              db
                .select({ shop: shops })
                .from(shops)
                .innerJoin(merchants, eq(shops.merchantId, merchants.id))
                .where(and(eq(shops.slug, shopSlug), eq(merchants.slug, merchantSlug)))
                .limit(1)
            ),
            ([row]) =>
              row
                ? Effect.succeed({
                    id: row.shop.id,
                    brandId: row.shop.brandId,
                    merchantId: row.shop.merchantId,
                    slug: row.shop.slug,
                    publicName: row.shop.publicName,
                    timezone: row.shop.timezone,
                    currency: row.shop.currency
                  })
                : Effect.fail(new ShopNotFound({ slug: shopSlug }))
          ),
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
