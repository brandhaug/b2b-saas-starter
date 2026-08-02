import { env } from 'cloudflare:workers'
import { createServerFn } from '@tanstack/react-start'
import { Effect, Layer, Schema } from 'effect'
import { layerFromD1 } from '@b2b-saas-starter/db'
import {
  MerchantContext,
  liveMerchantContext
} from '@b2b-saas-starter/capabilities/merchant-catalog'
import {
  makeStripeBilling,
  MerchantSubscriptions,
  type BillingInterval,
  type MerchantSubscription
} from '@b2b-saas-starter/capabilities/subscriptions'
import { selectCapabilitiesLayer } from '@b2b-saas-starter/capabilities/runtime'
import { runMerchantRequest } from './merchant-session.ts'

const CheckoutInput = Schema.Struct({
  interval: Schema.Literals(['monthly', 'annual']),
  idempotencyKey: Schema.String
})
const BillingMutation = Schema.Struct({
  idempotencyKey: Schema.String
})

const billing = () =>
  makeStripeBilling({
    secretKey: env.STRIPE_SUBSCRIPTION_SECRET_KEY,
    monthlyPriceId: env.STRIPE_SOLO_MONTHLY_PRICE_ID,
    annualPriceId: env.STRIPE_SOLO_ANNUAL_PRICE_ID,
    portalConfigurationId: env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID
  })

const runSubscription = <A, E>(
  userId: string,
  effect: Effect.Effect<A, E, MerchantSubscriptions | MerchantContext>
) => {
  if (!env.DB) throw new Error('Merchant Subscription requires D1.')
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(
        Layer.merge(
          selectCapabilitiesLayer({ DB: env.DB }),
          liveMerchantContext(userId).pipe(Layer.provide(layerFromD1(env.DB)))
        )
      )
    )
  )
}

export type OwnerBillingView = MerchantSubscription & {
  readonly billingConfigured: boolean
}

export const getOwnerBilling = createServerFn({ method: 'GET' }).handler(
  async (): Promise<OwnerBillingView> =>
    runMerchantRequest('financial.read', (session) =>
      runSubscription(
        session.user.id,
        Effect.gen(function* () {
          const merchant = yield* MerchantContext
          const subscriptions = yield* MerchantSubscriptions
          const current = yield* subscriptions.get(merchant.id)
          return { ...current, billingConfigured: billing().state === 'configured' }
        })
      )
    )
)

export const startSoloCheckout = createServerFn({ method: 'POST' })
  .validator((input: unknown) => Schema.decodeUnknownSync(CheckoutInput)(input))
  .handler(
    async ({ data }): Promise<{ readonly url: string }> =>
      runMerchantRequest('billing-destination.update', (session) =>
        runSubscription(
          session.user.id,
          Effect.gen(function* () {
            const merchant = yield* MerchantContext
            const subscription = yield* (yield* MerchantSubscriptions).get(merchant.id)
            return yield* billing().createCheckout({
              merchantId: merchant.id,
              ownerEmail: session.user.email,
              interval: data.interval as BillingInterval,
              idempotencyKey: data.idempotencyKey,
              successUrl: `${env.MERCHANT_APP_ORIGIN ?? 'http://localhost:3072'}/settings/subscription?checkout=complete`,
              cancelUrl: `${env.MERCHANT_APP_ORIGIN ?? 'http://localhost:3072'}/settings/subscription`,
              existingCustomerRef: subscription.providerCustomerRef,
              trialEndsAt:
                subscription.access === 'trialing'
                  ? subscription.trialEndsAt
                  : undefined
            })
          })
        )
      )
  )

export const openBillingPortal = createServerFn({ method: 'POST' })
  .validator((input: unknown) => Schema.decodeUnknownSync(BillingMutation)(input))
  .handler(
    async ({ data }): Promise<{ readonly url: string }> =>
      runMerchantRequest('billing-destination.update', (session) =>
        runSubscription(
          session.user.id,
          Effect.gen(function* () {
            const merchant = yield* MerchantContext
            const subscription = yield* (yield* MerchantSubscriptions).get(merchant.id)
            if (!subscription.providerCustomerRef)
              return yield* Effect.fail(new Error('No billing customer exists.'))
            return yield* billing().createPortal({
              customerRef: subscription.providerCustomerRef,
              returnUrl: `${env.MERCHANT_APP_ORIGIN ?? 'http://localhost:3072'}/settings/subscription`,
              idempotencyKey: data.idempotencyKey
            })
          })
        )
      )
  )

const scheduleCancellation = (cancelAtPeriodEnd: boolean, idempotencyKey: string) =>
  runMerchantRequest('billing-destination.update', (session) =>
    runSubscription(
      session.user.id,
      Effect.gen(function* () {
        const merchant = yield* MerchantContext
        const subscription = yield* (yield* MerchantSubscriptions).get(merchant.id)
        if (!subscription.providerSubscriptionRef)
          return yield* Effect.fail(new Error('No paid subscription exists.'))
        yield* billing().setScheduledCancellation({
          subscriptionRef: subscription.providerSubscriptionRef,
          cancelAtPeriodEnd,
          idempotencyKey
        })
      })
    )
  )

export const cancelSoloAtPeriodEnd = createServerFn({ method: 'POST' })
  .validator((input: unknown) => Schema.decodeUnknownSync(BillingMutation)(input))
  .handler(({ data }) => scheduleCancellation(true, data.idempotencyKey))

export const undoSoloCancellation = createServerFn({ method: 'POST' })
  .validator((input: unknown) => Schema.decodeUnknownSync(BillingMutation)(input))
  .handler(({ data }) => scheduleCancellation(false, data.idempotencyKey))
