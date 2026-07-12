import { Context, Effect, Schema } from 'effect'
import { CapabilityUnavailable } from '../errors.ts'
import { BrandId, ShopId } from '../ids.ts'

export const Brand = Schema.Struct({ id: BrandId, name: Schema.String })
export const Shop = Schema.Struct({
  id: ShopId,
  brandId: BrandId,
  merchantId: Schema.NullOr(Schema.String),
  slug: Schema.String,
  publicName: Schema.String,
  timezone: Schema.String,
  currency: Schema.String
})
export type Shop = typeof Shop.Type

export class ShopNotFound extends Schema.TaggedErrorClass<ShopNotFound>()(
  'ShopNotFound',
  { slug: Schema.String }
) {}

export type ShopTopologyShape = {
  readonly listAll: () => Effect.Effect<readonly Shop[], CapabilityUnavailable>
  readonly findByBookingPath: (input: {
    readonly merchantSlug: string
    readonly shopSlug: string
  }) => Effect.Effect<Shop, ShopNotFound | CapabilityUnavailable>
  readonly findBySlug: (
    slug: string
  ) => Effect.Effect<Shop, ShopNotFound | CapabilityUnavailable>
}

export class ShopTopology extends Context.Service<ShopTopology, ShopTopologyShape>()(
  '@b2b-saas-starter/capabilities/ShopTopology'
) {}
