import { Effect } from 'effect'
import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { type BillingOptions, billingConfigured } from './billing-config.ts'
import { PLANS } from './plan-catalog.ts'
import { readStripeObject, StripePriceResponse } from './stripe.ts'

/** Stripe uses hundredths for ISK/UGX charges despite their currency display exponent. */
export function stripeUnitAmount(amount: number, currency: string): number {
  const code = currency.toUpperCase()
  const zero = new Set([
    'BIF',
    'CLP',
    'DJF',
    'GNF',
    'JPY',
    'KMF',
    'KRW',
    'MGA',
    'PYG',
    'RWF',
    'VND',
    'VUV',
    'XAF',
    'XOF',
    'XPF'
  ])
  const three = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND'])
  if (zero.has(code)) {
    return amount
  }
  if (three.has(code)) {
    return amount / 1000
  }
  return amount / 100
}

export const validatedStripePrice = Effect.fn('Billing.validatePrice')(function* (
  secretKey: string,
  priceId: string,
  purpose: 'purchase' | 'subscription' = 'purchase'
) {
  const price = yield* readStripeObject(
    secretKey,
    `prices/${encodeURIComponent(priceId)}`,
    StripePriceResponse
  )
  if (
    price.id !== priceId ||
    (purpose === 'purchase' && !price.active) ||
    price.unit_amount === null ||
    price.unit_amount < 0 ||
    !Number.isSafeInteger(price.unit_amount) ||
    !/^[a-z]{3}$/.test(price.currency) ||
    price.billing_scheme !== 'per_unit' ||
    price.transform_quantity !== null ||
    price.recurring?.interval !== 'month' ||
    price.recurring.interval_count !== 1 ||
    price.recurring.usage_type !== 'licensed'
  ) {
    return yield* Effect.fail(
      new CapabilityUnavailable({ capability: 'billing', reason: 'unsupported_price' })
    )
  }
  return {
    amount: stripeUnitAmount(price.unit_amount, price.currency),
    currency: price.currency.toUpperCase()
  }
})

export const displayedBillingPlans = Effect.fn('Billing.displayedPlans')(function* (
  options: BillingOptions
) {
  if (!billingConfigured(options) || options.secretKey === undefined) {
    return PLANS.map((plan) => ({ ...plan, providerPrice: plan.price }))
  }
  const secretKey = options.secretKey
  return yield* Effect.forEach(PLANS, (plan) =>
    Effect.gen(function* () {
      if (plan.purchase !== 'self_serve') {
        return { ...plan, providerPrice: plan.price }
      }
      const priceId = options.priceIds?.[plan.id]
      if (priceId === undefined) {
        return yield* Effect.fail(
          new CapabilityUnavailable({
            capability: 'billing',
            reason: 'price_not_configured'
          })
        )
      }
      return { ...plan, providerPrice: yield* validatedStripePrice(secretKey, priceId) }
    })
  )
})
