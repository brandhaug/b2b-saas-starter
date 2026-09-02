import { Billing } from '@b2b-saas-starter/capabilities/billing/billing'
import {
  planForStripeEvent,
  verifyStripeSignature
} from '@b2b-saas-starter/capabilities/billing/stripe'
import { withTriggerScope } from '@b2b-saas-starter/logger'
import { Effect, Result, Schema, type Scope } from 'effect'
import { type CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import {
  selectCapabilitiesLayer,
  starterEnv
} from '@b2b-saas-starter/capabilities/runtime'
import { runInvocation, type Env } from './webhook-consumer.ts'

/**
 * The subset of a Stripe event body this worker understands. Everything else
 * decodes fine and is ignored — an unknown event type is not an error, the
 * same leniency the webhook delivery reader applies.
 */
export const StripeEventBody = Schema.Struct({
  type: Schema.String,
  data: Schema.Struct({
    object: Schema.Struct({
      client_reference_id: Schema.optionalKey(Schema.String),
      metadata: Schema.optionalKey(
        Schema.Struct({
          workspaceId: Schema.optionalKey(Schema.String),
          planId: Schema.optionalKey(Schema.String)
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
 * Core of the Stripe webhook: map the event onto a plan change via the shared
 * billing policy (`planForStripeEvent`) and hand it to the billing capability,
 * which updates `workspaces.planId` and writes the matching audit event
 * atomically. Malformed or irrelevant events skip (log-and-return); real
 * failures fail so `handleStripeWebhook` rejects and the fetch handler answers
 * 500, which is what makes Stripe redeliver. Exported with requirements open
 * for tests, like `processWebhookMessage`.
 */
/**
 * Where a handled event's plan change lands: either a resolved target or the
 * skip reason recorded on the wide event. The static-plan branch takes its
 * plan id from the policy table; the metadata branch requires both the
 * workspace and an explicit plan id from Stripe's metadata.
 */
function resolvePlanTarget(
  plan: NonNullable<ReturnType<typeof planForStripeEvent>>,
  workspaceId: string | undefined,
  metadata: { readonly planId?: string | undefined }
):
  | { readonly workspaceId: string; readonly planId: string }
  | { readonly skipReason: string } {
  if (plan.kind === 'from_metadata') {
    if (!workspaceId || !metadata.planId) {
      return { skipReason: 'missing_workspace_or_plan' }
    }
    return { workspaceId, planId: metadata.planId }
  }
  if (!workspaceId) {
    return { skipReason: 'missing_workspace' }
  }
  return { workspaceId, planId: plan.planId }
}

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
    yield* Effect.annotateLogsScoped({ stripeEventType: event.type })
    const plan = planForStripeEvent(event.type)
    if (!plan) {
      yield* Effect.annotateLogsScoped({
        outcome: 'ignored',
        reason: 'unhandled_event_type'
      })
      return
    }
    const target = resolvePlanTarget(
      plan,
      metadata.workspaceId ?? object.client_reference_id,
      metadata
    )
    if ('skipReason' in target) {
      yield* Effect.annotateLogsScoped({
        outcome: 'skipped',
        skipReason: target.skipReason
      })
      return
    }
    yield* applyPlan(target.workspaceId, target.planId, event.type)
  })
}

/** One plan change per handled event; annotates applied vs unknown workspace. */
function applyPlan(
  workspaceId: string,
  planId: string,
  source: string
): Effect.Effect<void, CapabilityUnavailable, Billing | Scope.Scope> {
  return Effect.gen(function* () {
    const billing = yield* Billing
    const applied = yield* billing.applyProviderEvent({
      workspaceId,
      planId,
      detail: { source }
    })
    if (applied) {
      yield* Effect.annotateLogsScoped({ outcome: 'applied' })
    } else {
      yield* Effect.annotateLogsScoped({ outcome: 'unknown_workspace' })
    }
  })
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
