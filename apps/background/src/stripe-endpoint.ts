import {
  Billing,
  type ProcessProviderEventInput
} from '@b2b-saas-starter/billing/billing'
import {
  subscriptionLinkForStripeEvent,
  verifyStripeSignature
} from '@b2b-saas-starter/billing/stripe'
import { publishProviderEvent } from '@b2b-saas-starter/billing/seat-sync'
import {
  billingConfigured,
  billingOptionsFromEnv
} from '@b2b-saas-starter/billing/billing-config'
import { withTriggerScope } from '@b2b-saas-starter/logger'
import { Effect, Result, Schema } from 'effect'
import { selectCapabilitiesLayer } from '@b2b-saas-starter/capabilities/runtime'
import { billingCapabilitiesEnv } from './billing-runtime.ts'
import { runInvocation, type Env } from './queue-consumer.ts'

/**
 * The subset of a Stripe event body this worker understands. Everything else
 * decodes fine and is ignored — an unknown event type is not an error, the
 * same leniency the webhook delivery reader applies. The `items` array is the
 * subscription's line items; the starter bills exactly one (the seat price),
 * so the policy reads only its first entry.
 */
const StripeEventBody = Schema.Struct({
  // Keep Stripe's delivery identity and provider timestamp at the boundary.
  // They are required for idempotent processing and for operators to join a
  // durable provider-event row back to Stripe's dashboard.
  id: Schema.String,
  created: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: 8_640_000_000_000 })
  ),
  type: Schema.String,
  data: Schema.Struct({
    object: Schema.Struct({
      id: Schema.optionalKey(Schema.String),
      client_reference_id: Schema.optionalKey(Schema.String),
      customer: Schema.optionalKey(Schema.String),
      subscription: Schema.optionalKey(Schema.NullOr(Schema.String)),
      parent: Schema.optionalKey(
        Schema.NullOr(
          Schema.Struct({
            subscription_details: Schema.optionalKey(
              Schema.NullOr(Schema.Struct({ subscription: Schema.String }))
            )
          })
        )
      ),
      metadata: Schema.optionalKey(
        Schema.Struct({
          workspaceId: Schema.optionalKey(Schema.String),
          planId: Schema.optionalKey(Schema.String)
        })
      ),
      items: Schema.optionalKey(
        Schema.Struct({
          data: Schema.Array(
            Schema.Struct({
              id: Schema.optionalKey(Schema.String),
              quantity: Schema.optionalKey(Schema.Number)
            })
          )
        })
      )
    })
  })
})
// One codec for the raw-body boundary: JSON parse and shape decode in one
// total step, so malformed input is a `Result` failure rather than a throw.
const decodeStripeEvent = Schema.decodeUnknownResult(
  Schema.fromJsonString(StripeEventBody)
)

export function providerInputFromPayload(
  payload: string
): ProcessProviderEventInput | undefined {
  const decoded = decodeStripeEvent(payload)
  if (Result.isFailure(decoded)) {
    return undefined
  }
  const event = decoded.success
  const object = event.data.object
  const metadata = object.metadata ?? {}
  // oxlint-disable-next-line effect/noGlobals -- provider timestamps arrive as epoch seconds, and Date is the boundary codec here
  const providerCreatedAt = new Date(event.created * 1000).toISOString()
  const detail = {
    source: event.type,
    providerEventId: event.id,
    providerCreatedAt
  }
  const link = subscriptionLinkForStripeEvent(event.type, {
    ...object,
    subscription: object.subscription ?? undefined
  })
  if (!link) {
    return undefined
  }
  const workspaceId = metadata.workspaceId ?? object.client_reference_id
  let subscription: NonNullable<ProcessProviderEventInput['subscription']>
  if (link.kind === 'deleted') {
    subscription = {
      workspaceId,
      customerId: object.customer,
      subscriptionId: object.id,
      deleted: true,
      detail
    }
  } else if (link.kind === 'quantity') {
    subscription = {
      workspaceId,
      customerId: link.customerId,
      subscriptionId: link.subscriptionId,
      subscriptionItemId: link.subscriptionItemId,
      quantity: link.quantity,
      detail
    }
  } else {
    subscription = {
      workspaceId,
      customerId: link.customerId,
      subscriptionId: link.subscriptionId,
      detail
    }
  }
  return {
    providerEventId: event.id,
    eventType: event.type,
    providerCreatedAt,
    workspaceId,
    subscription,
    detail
  }
}

/**
 * Inbound Stripe webhooks (see docs/integrations/stripe-billing.mdx). The
 * route verifies Stripe's signature scheme against `STRIPE_WEBHOOK_SECRET`
 * before persisting routing evidence and enqueueing reconciliation. Missing
 * billing configuration or bindings return 503. Persistence and enqueue
 * failures return 500 so Stripe schedules a redelivery.
 */
// oxlint-disable-next-line effect/noAsyncFunction -- the Workers fetch contract is a plain async function; reading the raw body and verifying the HMAC are this adapter's two awaits, both total here
export async function handleStripeRequest(
  request: Request,
  env: Env
): Promise<Response> {
  const { pathname } = new URL(request.url)
  if (pathname !== '/webhooks/stripe') {
    return new Response('Not found', { status: 404 })
  }
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }
  const secret = env.STRIPE_WEBHOOK_SECRET
  if (secret === undefined || secret.length === 0) {
    return Response.json({ error: 'billing_not_configured' }, { status: 503 })
  }
  const billing = billingOptionsFromEnv(env)
  if (
    !billingConfigured(billing ?? {}) ||
    env.DB === undefined ||
    env.BILLING_QUEUE === undefined
  ) {
    return Response.json({ error: 'billing_not_ready' }, { status: 503 })
  }
  const billingQueue = env.BILLING_QUEUE
  // oxlint-disable-next-line effect/noAsyncFunction -- reading the raw body is the adapter's first await, total here
  const payload = await request.text()
  // oxlint-disable-next-line effect/noAsyncFunction -- verifying the HMAC is the second; both complete before the response
  const valid = await verifyStripeSignature({
    secret,
    payload,
    header: request.headers.get('stripe-signature')
  })
  if (!valid) {
    return Response.json({ error: 'invalid_signature' }, { status: 400 })
  }
  const input = providerInputFromPayload(payload)
  if (input === undefined) {
    return new Response(null, { status: 200 })
  }
  const program = Effect.gen(function* () {
    const billingService = yield* Billing
    yield* billingService.recordProviderEvent(input)
    yield* publishProviderEvent(billingQueue, input)
  }).pipe(Effect.provide(selectCapabilitiesLayer(billingCapabilitiesEnv(env, billing))))
  return runInvocation(
    env,
    withTriggerScope(
      {
        service: 'background',
        event: 'stripe_webhook_ingest',
        env,
        spanKind: 'consumer'
      },
      program
    )
  ).then(
    () => new Response(null, { status: 200 }),
    () => Response.json({ error: 'processing_failed' }, { status: 500 })
  )
}
