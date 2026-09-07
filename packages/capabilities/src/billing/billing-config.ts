import { type ProviderEnvOf, hasValue } from '@b2b-saas-starter/env/server'

import { PLANS } from './plan-catalog.ts'

/** Stripe settings shared by the live adapter and provider workers. */
export type BillingOptions = {
  readonly secretKey?: string | undefined
  readonly priceIds?: Readonly<Record<string, string>> | undefined
}

/** A complete Stripe configuration has every self-serve catalog price. */
export function billingConfigured(options: BillingOptions): boolean {
  if (options.secretKey === undefined || options.secretKey.length === 0) {
    return false
  }
  return PLANS.every((plan) => {
    if (plan.stripePriceEnv === null) {
      return true
    }
    const priceId = options.priceIds?.[plan.id]
    return priceId !== undefined && priceId.length > 0
  })
}

/** Projects the worker's provider env into the billing option bag. */
export function billingOptionsFromEnv(
  env: ProviderEnvOf<'STRIPE_SECRET_KEY' | 'STRIPE_PRICE_ID_TEAM'>
): BillingOptions | undefined {
  const secretKey = env.STRIPE_SECRET_KEY
  if (!hasValue(secretKey)) {
    return undefined
  }
  const priceIds: Record<string, string> = {}
  const teamPriceId = env.STRIPE_PRICE_ID_TEAM
  if (hasValue(teamPriceId)) {
    priceIds.team = teamPriceId
  }
  return { secretKey, priceIds }
}
