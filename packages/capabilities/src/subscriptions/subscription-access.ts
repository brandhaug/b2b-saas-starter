import { Effect } from 'effect'
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
