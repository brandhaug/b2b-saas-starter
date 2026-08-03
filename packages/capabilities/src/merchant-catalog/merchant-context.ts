import { Context, Effect, Layer, Schema } from 'effect'
import { and, eq } from 'drizzle-orm'
import { Database, merchantMemberships, merchants } from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'

export const MerchantIdentity = Schema.Struct({
  id: Schema.String,
  actorUserId: Schema.optional(Schema.String),
  publicName: Schema.String,
  slug: Schema.String,
  timezone: Schema.String,
  currency: Schema.String,
  plan: Schema.Literal('solo')
})
export type MerchantIdentity = typeof MerchantIdentity.Type

export class MerchantContextNotFound extends Schema.TaggedErrorClass<MerchantContextNotFound>()(
  'MerchantContextNotFound',
  {}
) {}

export class MerchantContext extends Context.Service<
  MerchantContext,
  MerchantIdentity
>()('@b2b-saas-starter/capabilities/MerchantContext') {}

export const testMerchantContext = (
  merchant: MerchantIdentity
): Layer.Layer<MerchantContext> => Layer.succeed(MerchantContext)(merchant)

/** Resolves the Merchant Owner boundary from persisted membership per request. */
export const liveMerchantContext = (
  userId: string
): Layer.Layer<
  MerchantContext,
  MerchantContextNotFound | CapabilityUnavailable,
  Database
> =>
  Layer.effect(
    MerchantContext,
    Effect.gen(function* () {
      const db = yield* Database
      const rows = yield* orUnavailable('merchant-context')(
        db
          .select({ merchant: merchants })
          .from(merchantMemberships)
          .innerJoin(merchants, eq(merchants.id, merchantMemberships.merchantId))
          .where(
            and(
              eq(merchantMemberships.userId, userId),
              eq(merchantMemberships.role, 'owner')
            )
          )
          .limit(1)
      )
      const row = rows[0]?.merchant
      if (!row) return yield* Effect.fail(new MerchantContextNotFound())
      return {
        id: row.id,
        actorUserId: userId,
        publicName: row.publicName,
        slug: row.slug,
        timezone: row.timezone,
        currency: row.currency,
        plan: row.plan
      }
    })
  )
