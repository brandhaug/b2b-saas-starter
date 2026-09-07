import { Effect } from 'effect'
import { expect, it } from '@effect/vitest'
import { vi } from 'vite-plus/test'
import { displayedBillingPlans, validatedStripePrice } from './stripe-pricing.ts'
import { billingConfigured } from './billing-config.ts'
import { testPrice } from './provider-test-fixtures.ts'

it.effect(
  'displays the configured monthly unit price and handles zero/two/three-decimal currencies',
  () => {
    let price = { ...testPrice, unit_amount: 2750, currency: 'nok' }
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json(price)))
    )
    return Effect.gen(function* () {
      const options = { secretKey: 'sk_test', priceIds: { team: 'price_team' } }
      expect(billingConfigured(options)).toBe(true)
      const plans = yield* displayedBillingPlans(options)
      expect(plans.find((plan) => plan.id === 'team')?.providerPrice).toEqual({
        amount: 27.5,
        currency: 'NOK'
      })
      expect(plans.find((plan) => plan.id === 'enterprise')?.purchase).toBe('sales')
      price = { ...price, unit_amount: 2500, currency: 'jpy' }
      expect(yield* validatedStripePrice('sk_test', 'price_team')).toEqual({
        amount: 2500,
        currency: 'JPY'
      })
      price = { ...price, unit_amount: 12_345, currency: 'kwd' }
      expect(yield* validatedStripePrice('sk_test', 'price_team')).toEqual({
        amount: 12.345,
        currency: 'KWD'
      })
      price = { ...price, unit_amount: 120_000, currency: 'isk' }
      expect(yield* validatedStripePrice('sk_test', 'price_team')).toEqual({
        amount: 1200,
        currency: 'ISK'
      })
    }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals())))
  }
)

it.effect(
  'rejects annual, metered, tiered and transformed prices instead of displaying example pricing',
  () => {
    let price: unknown = testPrice
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json(price)))
    )
    return Effect.gen(function* () {
      for (const unsupported of [
        { ...testPrice, recurring: { ...testPrice.recurring, interval: 'year' } },
        { ...testPrice, recurring: { ...testPrice.recurring, usage_type: 'metered' } },
        { ...testPrice, recurring: { ...testPrice.recurring, interval_count: 2 } },
        { ...testPrice, billing_scheme: 'tiered' },
        { ...testPrice, transform_quantity: { divide_by: 10, round: 'up' } }
      ]) {
        price = unsupported
        expect(
          (yield* Effect.flip(validatedStripePrice('sk_test', 'price_team'))).reason
        ).toBe('unsupported_price')
      }
    }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals())))
  }
)

it.effect('recognizes archived subscription prices but refuses new purchases', () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(Response.json({ ...testPrice, active: false })))
  )
  return Effect.gen(function* () {
    expect(
      (yield* Effect.flip(validatedStripePrice('sk_test', 'price_team'))).reason
    ).toBe('unsupported_price')
    expect(
      yield* validatedStripePrice('sk_test', 'price_team', 'subscription')
    ).toEqual({ amount: 12, currency: 'USD' })
  }).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllGlobals())))
})
