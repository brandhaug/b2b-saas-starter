import { Effect, Schema } from 'effect'
import {
  SubscriptionDenied,
  SOLO_PRICES,
  type BillingInterval,
  type MerchantSubscription,
  type MerchantSubscriptionsShape,
  type SubscriptionEvidence
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
  readonly endGraceSubscription: (input: {
    readonly subscriptionRef: string
    readonly invoiceRef: string
    readonly idempotencyKey: string
  }) => Effect.Effect<void, SubscriptionDenied>
  readonly scheduleIntervalChange: (input: {
    readonly merchantId: string
    readonly subscription: MerchantSubscription
    readonly interval: BillingInterval
    readonly idempotencyKey: string
    readonly now: string
  }) => Effect.Effect<SubscriptionEvidence, SubscriptionDenied>
  readonly retrieve: (input: {
    readonly merchantId: string
    readonly subscription: MerchantSubscription
  }) => Effect.Effect<StripeSubscriptionSnapshot, SubscriptionDenied>
}

export type StripeSubscriptionSnapshot = {
  readonly customerRef?: string | undefined
  readonly currentPeriodEndsAt?: string | undefined
  readonly currentPeriodStartsAt?: string | undefined
  readonly itemRef?: string | undefined
  readonly priceRef?: string | undefined
  readonly latestInvoice?:
    | {
        readonly id: string
        readonly status: 'paid' | 'uncollectible' | 'void' | 'open' | 'draft'
        readonly occurredAt: string
      }
    | undefined
}

export const reconciliationEvidence = (input: {
  readonly now: string
  readonly subscription: MerchantSubscription
  readonly snapshot: StripeSubscriptionSnapshot
}): import('./merchant-subscriptions.ts').SubscriptionEvidence | undefined => {
  const providerSubscriptionRef = input.subscription.providerSubscriptionRef
  const providerCustomerRef =
    input.snapshot.customerRef ?? input.subscription.providerCustomerRef
  const invoice = input.snapshot.latestInvoice
  if (
    !providerSubscriptionRef ||
    !providerCustomerRef ||
    !invoice ||
    (invoice.status !== 'paid' && invoice.status !== 'uncollectible')
  )
    return undefined
  return {
    merchantId: input.subscription.merchantId,
    eventId: `reconcile:${providerSubscriptionRef}:${invoice.id}:${invoice.status}`,
    occurredAt: invoice.occurredAt,
    kind: invoice.status === 'paid' ? 'invoice-paid' : 'invoice-payment-failed',
    providerCustomerRef,
    providerSubscriptionRef,
    periodEndsAt:
      input.snapshot.currentPeriodEndsAt ?? input.subscription.currentPeriodEndsAt,
    priceId:
      input.subscription.interval === 'monthly'
        ? 'price_solo_monthly'
        : 'price_solo_annual',
    amountMinor: input.subscription.price.amountMinor,
    currency: 'EUR'
  }
}

export const changeStripeCancellation = (input: {
  readonly subscriptions: MerchantSubscriptionsShape
  readonly billing: StripeBilling
  readonly subscription: MerchantSubscription
  readonly cancelAtPeriodEnd: boolean
  readonly idempotencyKey: string
  readonly now: string
}) => {
  const providerSubscriptionRef = input.subscription.providerSubscriptionRef
  const providerCustomerRef = input.subscription.providerCustomerRef
  if (!providerSubscriptionRef || !providerCustomerRef)
    return Effect.fail(new SubscriptionDenied({ reason: 'invalid_state' }))
  if (input.cancelAtPeriodEnd && input.subscription.access === 'grace')
    return Effect.gen(function* () {
      const snapshot = yield* input.billing.retrieve({
        merchantId: input.subscription.merchantId,
        subscription: input.subscription
      })
      if (!snapshot.latestInvoice)
        return yield* Effect.fail(new SubscriptionDenied({ reason: 'invalid_state' }))
      yield* input.billing.endGraceSubscription({
        subscriptionRef: providerSubscriptionRef,
        invoiceRef: snapshot.latestInvoice.id,
        idempotencyKey: input.idempotencyKey
      })
      yield* input.subscriptions.recordEvidence({
        merchantId: input.subscription.merchantId,
        eventId: `owner-grace-cancel:${input.idempotencyKey}`,
        occurredAt: input.now,
        kind: 'subscription-ended',
        providerCustomerRef,
        providerSubscriptionRef
      })
    })
  return input.billing.setScheduledCancellation({
    subscriptionRef: providerSubscriptionRef,
    cancelAtPeriodEnd: input.cancelAtPeriodEnd,
    idempotencyKey: input.idempotencyKey
  })
}

export const startStripeCheckout = (input: {
  readonly billing: StripeBilling
  readonly subscription: MerchantSubscription
  readonly ownerEmail: string
  readonly interval: BillingInterval
  readonly successUrl: string
  readonly cancelUrl: string
  readonly idempotencyKey: string
}) => {
  if (
    input.subscription.access === 'active' ||
    input.subscription.providerSubscriptionRef
  )
    return Effect.fail(new SubscriptionDenied({ reason: 'invalid_state' }))
  return input.billing.createCheckout({
    merchantId: input.subscription.merchantId,
    ownerEmail: input.ownerEmail,
    interval: input.interval,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
    idempotencyKey: input.idempotencyKey,
    existingCustomerRef: input.subscription.providerCustomerRef,
    trialEndsAt:
      input.subscription.access === 'trialing'
        ? input.subscription.trialEndsAt
        : undefined
  })
}

export const changeStripeInterval = (input: {
  readonly subscriptions: MerchantSubscriptionsShape
  readonly billing: StripeBilling
  readonly subscription: MerchantSubscription
  readonly interval: BillingInterval
  readonly idempotencyKey: string
  readonly now: string
}) => {
  if (
    input.subscription.access !== 'active' ||
    input.subscription.interval === input.interval
  )
    return Effect.fail(new SubscriptionDenied({ reason: 'invalid_state' }))
  return Effect.flatMap(
    input.billing.scheduleIntervalChange({
      merchantId: input.subscription.merchantId,
      subscription: input.subscription,
      interval: input.interval,
      idempotencyKey: input.idempotencyKey,
      now: input.now
    }),
    input.subscriptions.recordEvidence
  )
}

export const reconcileStripeSubscription = (input: {
  readonly subscriptions: MerchantSubscriptionsShape
  readonly billing: StripeBilling
  readonly subscription: MerchantSubscription
  readonly now: string
}) =>
  Effect.gen(function* () {
    const snapshot = yield* input.billing.retrieve({
      merchantId: input.subscription.merchantId,
      subscription: input.subscription
    })
    const evidence = reconciliationEvidence({
      now: input.now,
      subscription: input.subscription,
      snapshot
    })
    if (evidence?.kind === 'invoice-paid')
      return yield* input.subscriptions.reconcile(evidence)
    if (
      input.subscription.access === 'grace' &&
      input.subscription.graceEndsAt &&
      input.subscription.graceEndsAt <= input.now &&
      snapshot.latestInvoice &&
      input.subscription.providerSubscriptionRef &&
      input.subscription.providerCustomerRef
    ) {
      yield* input.billing.endGraceSubscription({
        subscriptionRef: input.subscription.providerSubscriptionRef,
        invoiceRef: snapshot.latestInvoice.id,
        idempotencyKey: `grace-expiry:${input.subscription.merchantId}:${input.subscription.graceEndsAt}`
      })
      return yield* input.subscriptions.recordEvidence({
        merchantId: input.subscription.merchantId,
        eventId: `grace-expired:${input.subscription.graceEndsAt}`,
        occurredAt: input.subscription.graceEndsAt,
        kind: 'subscription-ended',
        providerCustomerRef: input.subscription.providerCustomerRef,
        providerSubscriptionRef: input.subscription.providerSubscriptionRef
      })
    }
    return evidence
      ? yield* input.subscriptions.reconcile(evidence)
      : input.subscription
  })

export const reconcileAllStripeSubscriptions = (input: {
  readonly subscriptions: MerchantSubscriptionsShape
  readonly billing: StripeBilling
  readonly now: string
}) =>
  Effect.flatMap(input.subscriptions.providerBacked(), (subscriptions) =>
    Effect.forEach(
      subscriptions,
      (subscription) =>
        reconcileStripeSubscription({
          subscriptions: input.subscriptions,
          billing: input.billing,
          subscription,
          now: input.now
        }),
      { concurrency: 4, discard: true }
    )
  )

const StripeUrlResponse = Schema.Struct({ url: Schema.String })
const decodeUrl = Schema.decodeUnknownSync(StripeUrlResponse)
const StripeSubscriptionResponse = Schema.Struct({
  customer: Schema.optional(Schema.String),
  current_period_end: Schema.optional(Schema.Number),
  current_period_start: Schema.optional(Schema.Number),
  items: Schema.optional(
    Schema.Struct({
      data: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          price: Schema.Struct({ id: Schema.String })
        })
      )
    })
  ),
  latest_invoice: Schema.optional(
    Schema.Union([
      Schema.String,
      Schema.Struct({
        id: Schema.String,
        status: Schema.Literals(['paid', 'uncollectible', 'void', 'open', 'draft']),
        created: Schema.Number
      })
    ])
  )
})
const decodeSubscription = Schema.decodeUnknownSync(StripeSubscriptionResponse)
const StripeIdentifierResponse = Schema.Struct({ id: Schema.String })
const decodeIdentifier = Schema.decodeUnknownSync(StripeIdentifierResponse)

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
    options: {
      readonly body?: URLSearchParams
      readonly idempotencyKey?: string
      readonly method?: 'GET' | 'POST' | 'DELETE'
    }
  ) =>
    configured
      ? Effect.tryPromise({
          try: async () => {
            const response = await (config.fetch ?? globalThis.fetch)(
              `https://api.stripe.com/v1/${path}`,
              {
                method: options.method ?? (options.body ? 'POST' : 'GET'),
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
    endGraceSubscription: (input) =>
      Effect.all([
        request(`invoices/${encodeURIComponent(input.invoiceRef)}/void`, {
          idempotencyKey: `${input.idempotencyKey}:void`,
          body: form([])
        }),
        request(`subscriptions/${encodeURIComponent(input.subscriptionRef)}`, {
          idempotencyKey: `${input.idempotencyKey}:cancel`,
          method: 'DELETE'
        })
      ]).pipe(Effect.asVoid),
    scheduleIntervalChange: (input) =>
      Effect.gen(function* () {
        const subscriptionRef = input.subscription.providerSubscriptionRef
        const customerRef = input.subscription.providerCustomerRef
        if (!subscriptionRef || !customerRef)
          return yield* Effect.fail(new SubscriptionDenied({ reason: 'invalid_state' }))
        const snapshot = yield* request(
          `subscriptions/${encodeURIComponent(subscriptionRef)}?expand[]=items.data.price`,
          {}
        ).pipe(Effect.map(decodeSubscription))
        const item = snapshot.items?.data[0]
        if (!snapshot.current_period_start || !snapshot.current_period_end || !item)
          return yield* Effect.fail(
            new SubscriptionDenied({ reason: 'provider_unavailable' })
          )
        const schedule = yield* request('subscription_schedules', {
          idempotencyKey: `${input.idempotencyKey}:create`,
          body: form([['from_subscription', subscriptionRef]])
        }).pipe(Effect.map(decodeIdentifier))
        const targetPrice =
          input.interval === 'monthly' ? config.monthlyPriceId! : config.annualPriceId!
        yield* request(`subscription_schedules/${encodeURIComponent(schedule.id)}`, {
          idempotencyKey: `${input.idempotencyKey}:update`,
          body: form([
            ['end_behavior', 'release'],
            ['metadata[merchant_id]', input.merchantId],
            ['phases[0][start_date]', String(snapshot.current_period_start)],
            ['phases[0][end_date]', String(snapshot.current_period_end)],
            ['phases[0][items][0][price]', item.price.id],
            ['phases[0][items][0][quantity]', '1'],
            ['phases[1][start_date]', String(snapshot.current_period_end)],
            ['phases[1][items][0][price]', targetPrice],
            ['phases[1][items][0][quantity]', '1']
          ])
        })
        return {
          merchantId: input.merchantId,
          eventId: `owner-interval-change:${input.idempotencyKey}`,
          occurredAt: input.now,
          kind: 'interval-change-scheduled',
          providerCustomerRef: customerRef,
          providerSubscriptionRef: subscriptionRef,
          periodEndsAt: new Date(snapshot.current_period_end * 1000).toISOString(),
          priceId:
            input.interval === 'monthly' ? 'price_solo_monthly' : 'price_solo_annual',
          amountMinor: SOLO_PRICES[input.interval].amountMinor,
          currency: 'EUR'
        }
      }),
    retrieve: (input) =>
      input.subscription.providerSubscriptionRef
        ? request(
            `subscriptions/${encodeURIComponent(input.subscription.providerSubscriptionRef)}?expand[]=latest_invoice.lines.data.price`,
            {}
          ).pipe(
            Effect.map(decodeSubscription),
            Effect.map((value) => ({
              ...(value.customer ? { customerRef: value.customer } : {}),
              ...(value.current_period_end
                ? {
                    currentPeriodEndsAt: new Date(
                      value.current_period_end * 1000
                    ).toISOString()
                  }
                : {}),
              ...(value.current_period_start
                ? {
                    currentPeriodStartsAt: new Date(
                      value.current_period_start * 1000
                    ).toISOString()
                  }
                : {}),
              ...(value.items?.data[0]
                ? {
                    itemRef: value.items.data[0].id,
                    priceRef: value.items.data[0].price.id
                  }
                : {}),
              ...(typeof value.latest_invoice === 'object'
                ? {
                    latestInvoice: {
                      id: value.latest_invoice.id,
                      status: value.latest_invoice.status,
                      occurredAt: new Date(
                        value.latest_invoice.created * 1000
                      ).toISOString()
                    }
                  }
                : {})
            }))
          )
        : Effect.fail(new SubscriptionDenied({ reason: 'not_found' }))
  }
}
