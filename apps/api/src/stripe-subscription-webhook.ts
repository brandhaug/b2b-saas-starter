import { Effect } from 'effect'
import {
  MerchantSubscriptions,
  type SubscriptionEvidence
} from '@b2b-saas-starter/capabilities/subscriptions'
import { selectCapabilitiesLayer } from '@b2b-saas-starter/capabilities/runtime'
import { bookingProductEnv, type ApiEnv } from './env.ts'

type StripeEvent = {
  readonly id: string
  readonly type: string
  readonly created: number
  readonly data: { readonly object: Record<string, unknown> }
}

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

const string = (value: unknown) => (typeof value === 'string' ? value : undefined)
const seconds = (value: unknown) =>
  typeof value === 'number' ? new Date(value * 1000).toISOString() : undefined

const evidenceFor = (
  event: StripeEvent,
  env: ApiEnv
): SubscriptionEvidence | undefined => {
  const object = event.data.object
  const metadata = (object.metadata ?? {}) as Record<string, unknown>
  const merchantId = string(metadata.merchant_id)
  const customer = string(object.customer)
  const subscription = string(object.subscription) ?? string(object.id)
  if (!merchantId || !customer || !subscription) return undefined
  const base = {
    merchantId,
    eventId: event.id,
    occurredAt: new Date(event.created * 1000).toISOString(),
    providerCustomerRef: customer,
    providerSubscriptionRef: subscription
  } as const
  if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
    const lines = (
      object.lines as { data?: Array<Record<string, unknown>> } | undefined
    )?.data
    const line = lines?.[0]
    const pricing = (line?.pricing ?? {}) as Record<string, unknown>
    const priceDetails = (pricing.price_details ?? {}) as Record<string, unknown>
    const actualPriceId =
      string(priceDetails.price) ??
      string((line?.price as Record<string, unknown> | undefined)?.id)
    const canonicalPriceId =
      actualPriceId === env.STRIPE_SOLO_MONTHLY_PRICE_ID
        ? 'price_solo_monthly'
        : actualPriceId === env.STRIPE_SOLO_ANNUAL_PRICE_ID
          ? 'price_solo_annual'
          : undefined
    return {
      ...base,
      kind:
        event.type === 'invoice.paid'
          ? ('invoice-paid' as const)
          : ('invoice-payment-failed' as const),
      periodEndsAt: seconds(line?.period_end) ?? seconds(object.period_end),
      priceId: canonicalPriceId,
      amountMinor:
        canonicalPriceId === 'price_solo_monthly'
          ? 1900
          : canonicalPriceId === 'price_solo_annual'
            ? 19000
            : undefined,
      currency: string(object.currency)?.toUpperCase() === 'EUR' ? 'EUR' : undefined
    }
  }
  if (event.type === 'customer.subscription.deleted')
    return { ...base, kind: 'subscription-ended' }
  if (event.type === 'charge.dispute.created')
    return { ...base, kind: 'chargeback-opened' }
  if (event.type === 'charge.dispute.closed' && object.status === 'won')
    return { ...base, kind: 'chargeback-won' }
  if (event.type === 'customer.subscription.updated')
    return {
      ...base,
      kind: object.cancel_at_period_end
        ? 'subscription-cancel-scheduled'
        : 'subscription-cancel-reversed'
    }
  return undefined
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
    event = JSON.parse(body) as StripeEvent
  } catch {
    return Response.json({ error: 'invalid_payload' }, { status: 400 })
  }
  const evidence = evidenceFor(event, env)
  if (!evidence) return new Response(null, { status: 204 })
  await Effect.runPromise(
    Effect.flatMap(MerchantSubscriptions, (service) =>
      service.recordEvidence(evidence)
    ).pipe(Effect.provide(selectCapabilitiesLayer(bookingProductEnv(env))))
  )
  return new Response(null, { status: 204 })
}
