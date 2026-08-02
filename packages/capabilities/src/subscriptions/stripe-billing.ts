import { Effect, Schema } from 'effect'
import {
  SubscriptionDenied,
  type BillingInterval,
  type MerchantSubscription
} from './merchant-subscriptions.ts'

export type StripeBillingConfiguration = {
  readonly secretKey?: string | undefined
  readonly monthlyPriceId?: string | undefined
  readonly annualPriceId?: string | undefined
  readonly portalConfigurationId?: string | undefined
  readonly fetch?: typeof globalThis.fetch | undefined
}

export type StripeBilling = {
  readonly state: 'configured' | 'needs_configuration'
  readonly createCheckout: (input: {
    readonly merchantId: string
    readonly ownerEmail: string
    readonly interval: BillingInterval
    readonly successUrl: string
    readonly cancelUrl: string
    readonly idempotencyKey: string
    readonly existingCustomerRef?: string | undefined
    readonly trialEndsAt?: string | undefined
  }) => Effect.Effect<{ readonly url: string }, SubscriptionDenied>
  readonly createPortal: (input: {
    readonly customerRef: string
    readonly returnUrl: string
    readonly idempotencyKey: string
  }) => Effect.Effect<{ readonly url: string }, SubscriptionDenied>
  readonly setScheduledCancellation: (input: {
    readonly subscriptionRef: string
    readonly cancelAtPeriodEnd: boolean
    readonly idempotencyKey: string
  }) => Effect.Effect<void, SubscriptionDenied>
  readonly retrieve: (input: {
    readonly merchantId: string
    readonly subscription: MerchantSubscription
  }) => Effect.Effect<unknown, SubscriptionDenied>
}

const StripeUrlResponse = Schema.Struct({ url: Schema.String })
const decodeUrl = Schema.decodeUnknownSync(StripeUrlResponse)

const form = (fields: ReadonlyArray<readonly [string, string]>) => {
  const body = new URLSearchParams()
  for (const [key, value] of fields) body.set(key, value)
  return body
}

export const makeStripeBilling = (
  config: StripeBillingConfiguration
): StripeBilling => {
  const configured = Boolean(
    config.secretKey?.trim() &&
    config.monthlyPriceId?.trim() &&
    config.annualPriceId?.trim()
  )
  const request = (
    path: string,
    options: { readonly body?: URLSearchParams; readonly idempotencyKey?: string }
  ) =>
    configured
      ? Effect.tryPromise({
          try: async () => {
            const response = await (config.fetch ?? globalThis.fetch)(
              `https://api.stripe.com/v1/${path}`,
              {
                method: options.body ? 'POST' : 'GET',
                headers: {
                  authorization: `Bearer ${config.secretKey!}`,
                  ...(options.body
                    ? { 'content-type': 'application/x-www-form-urlencoded' }
                    : {}),
                  ...(options.idempotencyKey
                    ? { 'idempotency-key': options.idempotencyKey }
                    : {})
                },
                ...(options.body ? { body: options.body } : {})
              }
            )
            if (!response.ok)
              throw new Error(`Stripe request failed with ${response.status}`)
            return response.json() as Promise<unknown>
          },
          catch: () => new SubscriptionDenied({ reason: 'provider_unavailable' })
        })
      : Effect.fail(new SubscriptionDenied({ reason: 'billing_not_configured' }))

  return {
    state: configured ? 'configured' : 'needs_configuration',
    createCheckout: (input) =>
      request('checkout/sessions', {
        idempotencyKey: input.idempotencyKey,
        body: form([
          ['mode', 'subscription'],
          ['client_reference_id', input.merchantId],
          ...(input.existingCustomerRef
            ? ([['customer', input.existingCustomerRef]] as const)
            : ([['customer_email', input.ownerEmail]] as const)),
          [
            'line_items[0][price]',
            input.interval === 'monthly'
              ? config.monthlyPriceId!
              : config.annualPriceId!
          ],
          ['line_items[0][quantity]', '1'],
          ['billing_address_collection', 'required'],
          ['tax_id_collection[enabled]', 'true'],
          ['automatic_tax[enabled]', 'true'],
          ['metadata[merchant_id]', input.merchantId],
          ['subscription_data[metadata][merchant_id]', input.merchantId],
          ...(input.trialEndsAt && Date.parse(input.trialEndsAt) > Date.now()
            ? ([
                [
                  'subscription_data[trial_end]',
                  String(Math.floor(Date.parse(input.trialEndsAt) / 1000))
                ]
              ] as const)
            : []),
          [
            'subscription_data[trial_settings][end_behavior][missing_payment_method]',
            'cancel'
          ],
          ['success_url', input.successUrl],
          ['cancel_url', input.cancelUrl]
        ])
      }).pipe(Effect.map(decodeUrl)),
    createPortal: (input) =>
      request('billing_portal/sessions', {
        idempotencyKey: input.idempotencyKey,
        body: form([
          ['customer', input.customerRef],
          ['return_url', input.returnUrl],
          ...(config.portalConfigurationId
            ? ([['configuration', config.portalConfigurationId]] as const)
            : [])
        ])
      }).pipe(Effect.map(decodeUrl)),
    setScheduledCancellation: (input) =>
      request(`subscriptions/${encodeURIComponent(input.subscriptionRef)}`, {
        idempotencyKey: input.idempotencyKey,
        body: form([
          ['cancel_at_period_end', input.cancelAtPeriodEnd ? 'true' : 'false']
        ])
      }).pipe(Effect.asVoid),
    retrieve: (input) =>
      input.subscription.providerSubscriptionRef
        ? request(
            `subscriptions/${encodeURIComponent(input.subscription.providerSubscriptionRef)}?expand[]=latest_invoice.lines.data.price`,
            {}
          )
        : Effect.fail(new SubscriptionDenied({ reason: 'not_found' }))
  }
}
