import { Effect, Schema } from 'effect'
import type { D1Database } from '@cloudflare/workers-types'
import { eq, sql, type SQLWrapper } from 'drizzle-orm'
import { Database, merchantSubscriptions, shops } from '@b2b-saas-starter/db'
import { CapabilityDenied, CapabilityUnavailable } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'

export type SubscriptionAccessOperation =
  | 'new-demand'
  | 'configuration'
  | 'read'
  | 'export'
  | 'billing-recovery'
  | 'existing-commitment'

type SubscriptionStatus = typeof merchantSubscriptions.$inferSelect.status
export const MerchantSubscriptionAccessState = Schema.Literals(['active', 'restricted'])
export type MerchantSubscriptionAccessState =
  typeof MerchantSubscriptionAccessState.Type

export const NEW_DEMAND_SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'grace'
] as const satisfies readonly SubscriptionStatus[]

/** Trusted SQL literal for raw D1 statements that cannot use Drizzle predicates. */
export const NEW_DEMAND_SUBSCRIPTION_SQL_VALUES = "'trialing','active','grace'"

export const subscriptionAllowsNewDemand = (
  status: SubscriptionStatus | null
): boolean =>
  status !== null &&
  NEW_DEMAND_SUBSCRIPTION_STATUSES.some((candidate) => candidate === status)

export const resolveMerchantSubscriptionAccessState = (
  d1: D1Database,
  merchantId: string
): Effect.Effect<MerchantSubscriptionAccessState | null, CapabilityUnavailable> =>
  Effect.tryPromise({
    try: async () => {
      const row = await d1
        .prepare(
          'SELECT status FROM merchant_subscriptions WHERE merchant_id = ? LIMIT 1'
        )
        .bind(merchantId)
        .first<{ status: SubscriptionStatus }>()
      if (!row) return null
      return Schema.decodeUnknownSync(MerchantSubscriptionAccessState)(
        subscriptionAllowsNewDemand(row.status) ? 'active' : 'restricted'
      )
    },
    catch: (cause) =>
      new CapabilityUnavailable({
        capability: 'merchant-subscription-access',
        reason: cause instanceof Error ? cause.message : String(cause)
      })
  })

/** Atomic D1 predicate for writes that create new merchant demand. */
export const subscriptionAllowsNewDemandSql = (merchantId: SQLWrapper) =>
  sql`EXISTS (
    SELECT 1 FROM merchant_subscriptions subscription
    WHERE subscription.merchant_id = ${merchantId}
      AND subscription.status IN ('trialing', 'active', 'grace')
  )`

export const subscriptionAccessAllows = (
  status: SubscriptionStatus | null,
  operation: SubscriptionAccessOperation
): boolean => {
  if (subscriptionAllowsNewDemand(status)) return true
  return (
    operation === 'read' ||
    operation === 'export' ||
    operation === 'billing-recovery' ||
    operation === 'existing-commitment'
  )
}

export const authorizeSubscriptionAccess = (
  db: typeof Database.Service,
  scope: { readonly merchantId: string } | { readonly shopId: string },
  operation: SubscriptionAccessOperation
): Effect.Effect<void, CapabilityDenied | CapabilityUnavailable> =>
  orUnavailable('merchant-subscription-access')(
    'merchantId' in scope
      ? db
          .select({ status: merchantSubscriptions.status })
          .from(merchantSubscriptions)
          .where(eq(merchantSubscriptions.merchantId, scope.merchantId))
          .limit(1)
      : db
          .select({ status: merchantSubscriptions.status })
          .from(shops)
          .leftJoin(
            merchantSubscriptions,
            eq(merchantSubscriptions.merchantId, shops.merchantId)
          )
          .where(eq(shops.id, scope.shopId))
          .limit(1)
  ).pipe(
    Effect.flatMap((rows) =>
      subscriptionAccessAllows(rows[0]?.status ?? null, operation)
        ? Effect.void
        : Effect.fail(new CapabilityDenied({ reason: 'restricted_access' }))
    )
  )
