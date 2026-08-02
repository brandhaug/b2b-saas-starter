import { Effect, Schema } from 'effect'
import {
  MerchantSubscriptions,
  subscriptionEvidenceFromProviderEvent,
  type SubscriptionEvidence
} from '@b2b-saas-starter/capabilities/subscriptions'
import { selectCapabilitiesLayer } from '@b2b-saas-starter/capabilities/runtime'
import { bookingProductEnv, type ApiEnv } from './env.ts'

const StripeMetadata = Schema.Record(Schema.String, Schema.String)
const StripeReference = Schema.Union([
  Schema.String,
  Schema.Struct({ id: Schema.String, metadata: Schema.optional(StripeMetadata) })
])
const StripeObject = Schema.Struct({
  id: Schema.String,
  customer: Schema.optional(StripeReference),
  subscription: Schema.optional(StripeReference),
  invoice: Schema.optional(StripeReference),
  charge: Schema.optional(StripeReference),
  metadata: Schema.optional(StripeMetadata),
  client_reference_id: Schema.optional(Schema.String),
  amount: Schema.optional(Schema.Number),
  amount_refunded: Schema.optional(Schema.Number),
  status: Schema.optional(Schema.String),
  cancel_at_period_end: Schema.optional(Schema.Boolean),
  period_end: Schema.optional(Schema.Number),
  current_period_end: Schema.optional(Schema.Number),
  currency: Schema.optional(Schema.String),
  parent: Schema.optional(
    Schema.Struct({
      subscription_details: Schema.optional(
        Schema.Struct({ subscription: Schema.optional(StripeReference) })
      )
    })
  ),
  lines: Schema.optional(
    Schema.Struct({
      data: Schema.Array(
        Schema.Struct({
          period_end: Schema.optional(Schema.Number),
          price: Schema.optional(Schema.Struct({ id: Schema.String })),
          pricing: Schema.optional(
            Schema.Struct({
              price_details: Schema.optional(
                Schema.Struct({ price: Schema.optional(Schema.String) })
              )
            })
          )
        })
      )
    })
  ),
  items: Schema.optional(
    Schema.Struct({
      data: Schema.Array(
        Schema.Struct({
          period_end: Schema.optional(Schema.Number),
          price: Schema.optional(Schema.Struct({ id: Schema.String }))
        })
      )
    })
  )
})
type StripeObject = typeof StripeObject.Type

const StripeEvent = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  created: Schema.Number,
  data: Schema.Struct({ object: StripeObject })
})
type StripeEvent = typeof StripeEvent.Type
const decodeStripeEvent = Schema.decodeUnknownSync(StripeEvent)

const encoder = new TextEncoder()
const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')

const safeEqual = (left: string, right: string) => {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return difference === 0
}

export const verifyStripeSignature = async (
  body: string,
  signatureHeader: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000)
) => {
  const fields = signatureHeader.split(',').map((part) => part.split('=', 2))
  const timestamp = fields.find(([key]) => key === 't')?.[1]
  const signatures = fields.filter(([key]) => key === 'v1').map(([, value]) => value!)
  if (!timestamp || Math.abs(nowSeconds - Number(timestamp)) > 300) return false
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const expected = hex(
    await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${body}`))
  )
  return signatures.some((signature) => safeEqual(signature, expected))
}

const referenceId = (value: string | { readonly id: string } | undefined) =>
  typeof value === 'string' ? value : value?.id
const seconds = (value: unknown) =>
  typeof value === 'number' ? new Date(value * 1000).toISOString() : undefined

const stripeObject = async (path: string, env: ApiEnv) => {
  if (!env.STRIPE_SUBSCRIPTION_SECRET_KEY) return undefined
  try {
    const response = await fetch(`https://api.stripe.com/v1/${path}`, {
      headers: { authorization: `Bearer ${env.STRIPE_SUBSCRIPTION_SECRET_KEY}` }
    })
    if (!response.ok) return undefined
    return Schema.decodeUnknownSync(StripeObject)(await response.json())
  } catch {
    return undefined
  }
}

const correlatedEvent = async (
  event: StripeEvent,
  env: ApiEnv
): Promise<StripeEvent> => {
  if (
    (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') &&
    !event.data.object.metadata?.merchant_id
  ) {
    const subscriptionId = referenceId(event.data.object.subscription)
    const subscription = subscriptionId
      ? await stripeObject(`subscriptions/${encodeURIComponent(subscriptionId)}`, env)
      : undefined
    if (subscription?.metadata?.merchant_id)
      return {
        ...event,
        data: {
          object: {
            ...event.data.object,
            metadata: subscription.metadata,
            customer: event.data.object.customer ?? subscription.customer
          }
        }
      }
  }
  if (
    event.type !== 'charge.refunded' &&
    event.type !== 'charge.dispute.created' &&
    event.type !== 'charge.dispute.closed'
  )
    return event
  const source = event.data.object
  const chargeId = event.type.startsWith('charge.dispute')
    ? referenceId(source.charge)
    : source.id
  if (!chargeId) return event
  const charge =
    event.type === 'charge.refunded'
      ? source
      : await stripeObject(`charges/${encodeURIComponent(chargeId)}`, env)
  const invoiceId = charge ? referenceId(charge.invoice) : undefined
  if (!invoiceId) return event
  const invoice = await stripeObject(
    `invoices/${encodeURIComponent(invoiceId)}?expand[]=parent.subscription_details.subscription`,
    env
  )
  if (!invoice) return event
  const subscriptionId =
    referenceId(invoice.parent?.subscription_details?.subscription) ??
    referenceId(invoice.subscription)
  const subscription = subscriptionId
    ? await stripeObject(`subscriptions/${encodeURIComponent(subscriptionId)}`, env)
    : undefined
  const metadata = subscription?.metadata ?? invoice.metadata ?? {}
  return {
    ...event,
    data: {
      object: {
        ...source,
        customer: charge?.customer ?? invoice.customer,
        subscription: subscriptionId,
        metadata
      }
    }
  }
}

const evidenceFor = (
  event: StripeEvent,
  env: ApiEnv
): SubscriptionEvidence | undefined => {
  const object = event.data.object
  const metadata = object.metadata ?? {}
  const merchantId = metadata.merchant_id ?? object.client_reference_id
  const customer = referenceId(object.customer)
  const subscription = referenceId(object.subscription) ?? object.id
  if (!merchantId || !customer || !subscription) return undefined
  const line = object.lines?.data[0] ?? object.items?.data[0]
  const actualPriceId =
    object.lines?.data[0]?.pricing?.price_details?.price ?? line?.price?.id
  return subscriptionEvidenceFromProviderEvent({
    merchantId,
    eventId: event.id,
    eventType: event.type,
    occurredAt: new Date(event.created * 1000).toISOString(),
    providerCustomerRef: customer,
    providerSubscriptionRef: subscription,
    periodEndsAt: seconds(line?.period_end) ?? seconds(object.period_end),
    actualPriceId,
    monthlyPriceId: env.STRIPE_SOLO_MONTHLY_PRICE_ID,
    annualPriceId: env.STRIPE_SOLO_ANNUAL_PRICE_ID,
    currency: object.currency,
    amount: object.amount,
    amountRefunded: object.amount_refunded,
    status: object.status,
    cancelAtPeriodEnd: object.cancel_at_period_end
  })
}

export const isStripeSubscriptionWebhookPath = (request: Request) =>
  request.method === 'POST' &&
  new URL(request.url).pathname === '/callbacks/stripe/subscriptions'

export const handleStripeSubscriptionWebhook = async (
  request: Request,
  env: ApiEnv
): Promise<Response> => {
  if (!env.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET)
    return Response.json({ error: 'billing_not_configured' }, { status: 503 })
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')
  if (
    !signature ||
    !(await verifyStripeSignature(
      body,
      signature,
      env.STRIPE_SUBSCRIPTION_WEBHOOK_SECRET
    ))
  )
    return Response.json({ error: 'invalid_signature' }, { status: 400 })
  let event: StripeEvent
  try {
    event = decodeStripeEvent(JSON.parse(body))
  } catch {
    return Response.json({ error: 'invalid_payload' }, { status: 400 })
  }
  event = await correlatedEvent(event, env)
  const evidence = evidenceFor(event, env)
  if (!evidence) {
    await Effect.runPromise(
      Effect.flatMap(MerchantSubscriptions, (service) =>
        service.retainUnmatchedEvent({
          eventId: event.id,
          eventType: event.type,
          reason: 'correlation_or_event_not_supported',
          receivedAt: new Date().toISOString()
        })
      ).pipe(Effect.provide(selectCapabilitiesLayer(bookingProductEnv(env))))
    )
    const retryableCorrelation =
      event.type === 'charge.dispute.created' ||
      event.type === 'charge.dispute.closed' ||
      event.type === 'invoice.paid' ||
      event.type === 'invoice.payment_failed'
    return retryableCorrelation
      ? Response.json({ error: 'correlation_pending' }, { status: 503 })
      : new Response(null, { status: 204 })
  }
  await Effect.runPromise(
    Effect.flatMap(MerchantSubscriptions, (service) =>
      service.recordEvidence(evidence)
    ).pipe(Effect.provide(selectCapabilitiesLayer(bookingProductEnv(env))))
  )
  return new Response(null, { status: 204 })
}
