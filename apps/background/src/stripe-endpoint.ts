import {
  Billing,
  type ProcessProviderEventInput
} from '@b2b-saas-starter/capabilities/billing/billing'
import {
  subscriptionLinkForStripeEvent,
  verifyStripeSignature,
  type StripeSubscriptionLink
} from '@b2b-saas-starter/capabilities/billing/stripe'
import { withTriggerScope } from '@b2b-saas-starter/logger'
import { Effect, Result, Schema, type Scope } from 'effect'
import { type CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import {
  selectCapabilitiesLayer,
  starterEnv
} from '@b2b-saas-starter/capabilities/runtime'
import { runInvocation, type Env } from './queue-consumer.ts'

/**
 * The subset of a Stripe event body this worker understands. Everything else
 * decodes fine and is ignored — an unknown event type is not an error, the
 * same leniency the webhook delivery reader applies. The `items` array is the
 * subscription's line items; the starter bills exactly one (the seat price),
 * so the policy reads only its first entry.
 */
export const StripeEventBody = Schema.Struct({
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

/**
 * Core of the Stripe webhook: map one verified provider envelope onto the
 * billing capability. Provider ids, timestamps, and customer/subscription
 * ids are routing evidence; the capability re-reads Stripe authority and
 * resolves the workspace when metadata is absent. Malformed or irrelevant
 * events skip (log-and-return); real failures fail so Stripe redelivers.
 */

export function processStripeEvent(
  payload: string
): Effect.Effect<void, CapabilityUnavailable, Billing | Scope.Scope> {
  return Effect.gen(function* () {
    const decoded = decodeStripeEvent(payload)
    if (Result.isFailure(decoded)) {
      yield* Effect.annotateLogsScoped({
        outcome: 'skipped',
        skipReason: 'unexpected_shape'
      })
      return
    }
    const event = decoded.success
    const object = event.data.object
    const metadata = object.metadata ?? {}
    yield* Effect.annotateLogsScoped({
      stripeEventId: event.id,
      stripeEventCreated: event.created,
      stripeEventType: event.type
    })

    // Keep provider identity in every capability detail. The capability owns
    // deduplication and persistence; the worker only maps the verified Stripe
    // envelope into its domain input.
    // Stripe's event envelope is seconds since epoch; this conversion is the
    // platform-boundary normalization used by durable billing evidence.
    // oxlint-disable-next-line effect/noGlobals -- provider timestamps arrive as epoch seconds, and Date is the boundary codec here
    const providerCreatedAt = new Date(event.created * 1000).toISOString()
    const providerDetail = {
      source: event.type,
      providerEventId: event.id,
      providerCreatedAt
    }

    // Checkout linkage, seat-quantity reconciliation, and deletion all use
    // the same capability call. Checkout metadata.planId is deliberately not
    // read here: the capability resolves the plan from Stripe's price.
    const link = subscriptionLinkForStripeEvent(event.type, {
      ...object,
      subscription: object.subscription ?? undefined
    })
    if (link) {
      const workspaceId = metadata.workspaceId ?? object.client_reference_id
      yield* processProviderEvent({
        providerEventId: event.id,
        eventType: event.type,
        providerCreatedAt,
        workspaceId,
        subscription: subscriptionInput(workspaceId, link, object, providerDetail),
        detail: providerDetail
      })
      return
    }

    yield* Effect.annotateLogsScoped({
      outcome: 'ignored',
      reason: 'unhandled_event_type'
    })
  })
}

/** One plan change per handled event; annotates applied vs unknown workspace. */
function processProviderEvent(
  input: ProcessProviderEventInput
): Effect.Effect<void, CapabilityUnavailable, Billing | Scope.Scope> {
  return Effect.gen(function* () {
    const billing = yield* Billing
    const result = yield* billing.processProviderEvent(input)
    yield* Effect.annotateLogsScoped({ outcome: result.outcome })
  })
}

function subscriptionInput(
  workspaceId: string | undefined,
  link: StripeSubscriptionLink,
  object: {
    readonly id?: string | undefined
    readonly customer?: string | undefined
  },
  detail: {
    readonly source: string
    readonly providerEventId: string
    readonly providerCreatedAt: string
  }
): NonNullable<ProcessProviderEventInput['subscription']> {
  // Built per branch rather than ternaries: the fields a deletion carries
  // are disjoint from the ones a link or quantity report carries.
  let input: NonNullable<ProcessProviderEventInput['subscription']>
  if (link.kind === 'deleted') {
    input = {
      workspaceId,
      customerId: object.customer,
      subscriptionId: object.id,
      deleted: true,
      detail
    }
  } else if (link.kind === 'quantity') {
    input = {
      workspaceId,
      customerId: link.customerId,
      subscriptionId: link.subscriptionId,
      subscriptionItemId: link.subscriptionItemId,
      quantity: link.quantity,
      detail
    }
  } else {
    input = {
      workspaceId,
      customerId: link.customerId,
      subscriptionId: link.subscriptionId,
      detail
    }
  }
  return input
}

/**
 * Entry wrapper for the Stripe webhook: provides the real capabilities layer
 * and a wide event so operators can see every inbound provider event. Failures
 * propagate on purpose — the fetch handler answers 500 on rejection so Stripe
 * schedules a redelivery.
 */
export function handleStripeWebhook(
  payload: string,
  env: Env
): Effect.Effect<void, CapabilityUnavailable, never> {
  const program = processStripeEvent(payload).pipe(
    Effect.provide(selectCapabilitiesLayer(starterEnv(env)))
  )
  return withTriggerScope(
    {
      service: 'background',
      event: 'stripe_webhook',
      env,
      spanKind: 'consumer'
    },
    program
  )
}

/**
 * Inbound Stripe webhooks (see docs/integrations/stripe-billing.mdx). The
 * route verifies Stripe's signature scheme against `STRIPE_WEBHOOK_SECRET`
 * and applies subscription changes to `workspaces.planId` through the
 * billing capability — unset env degrades to a 503, never to an unverified
 * state change. Failures answer 500 so Stripe schedules a redelivery.
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
  return runInvocation(env, handleStripeWebhook(payload, env)).then(
    () => new Response(null, { status: 200 }),
    () => Response.json({ error: 'processing_failed' }, { status: 500 })
  )
}
