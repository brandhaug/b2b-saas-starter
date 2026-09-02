import { Effect, Result, Schema } from 'effect'

import { CapabilityUnavailable } from '../errors.ts'
import { hmacSha256Hex } from '../internal/crypto.ts'
import { STARTER_PLAN } from './plan-catalog.ts'

/**
 * The Stripe provider adapter: the hand-rolled REST client, the inbound event
 * policy, and the webhook signature verifier. `billing.ts` composes this into
 * the capability; the background worker imports the event policy and the
 * verifier directly for its raw `fetch` handler. Nothing here reaches for the
 * `Billing` service, so the entitlement gate in `plan-catalog.ts` stays
 * provider-free.
 */

/** The part of Stripe's checkout-session reply this capability acts on. */
const StripeCheckoutResponse = Schema.Struct({
  url: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(
    Schema.Struct({ message: Schema.optionalKey(Schema.String) })
  )
})

// One compiled boundary decode: rebuilt once at module load, not per request.
const decodeStripeCheckoutResponse = Schema.decodeUnknownResult(StripeCheckoutResponse)

/** The form-encoded body Stripe's checkout-session endpoint expects. */
function stripeCheckoutBody(input: {
  readonly priceId: string
  readonly workspaceId: string
  readonly planId: string
  readonly successUrl: string
  readonly cancelUrl: string
}): string {
  const params = new URLSearchParams()
  params.set('mode', 'subscription')
  params.set('client_reference_id', input.workspaceId)
  params.set('success_url', input.successUrl)
  params.set('cancel_url', input.cancelUrl)
  params.set('line_items[0][price]', input.priceId)
  params.set('line_items[0][quantity]', '1')
  params.set('metadata[workspaceId]', input.workspaceId)
  params.set('metadata[planId]', input.planId)
  params.set('subscription_data[metadata][workspaceId]', input.workspaceId)
  params.set('subscription_data[metadata][planId]', input.planId)
  return params.toString()
}

/** Deadline for one outbound provider call (Stripe or siteverify). */
const PROVIDER_TIMEOUT = '10 seconds'

/**
 * The Workers global `fetch` wrapped at the platform-adapter boundary: an HTTP
 * client dependency would add weight, not safety, to one form-encoded POST,
 * but the call still gets `Effect.tryPromise`'s `AbortSignal` so interruption
 * and deadlines reach the socket, and transport failures are classified as
 * typed `CapabilityUnavailable` instead of defects.
 */
function stripePost(url: string, headers: Record<string, string>, body: string) {
  return Effect.tryPromise({
    try: (signal) =>
      // oxlint-disable-next-line effect/noGlobals -- see docstring above
      fetch(url, { method: 'POST', headers, body, signal }),
    catch: () =>
      new CapabilityUnavailable({
        capability: 'billing',
        reason: 'stripe request failed'
      })
  }).pipe(
    Effect.timeout(PROVIDER_TIMEOUT),
    // The deadline is the same "provider unreachable" failure the transport
    // path reports — never leak `TimeoutError` into the interface channel.
    Effect.catchTag('TimeoutError', () =>
      Effect.fail(
        new CapabilityUnavailable({
          capability: 'billing',
          reason: 'stripe request timed out'
        })
      )
    )
  )
}

function stripeJson(response: Response) {
  return Effect.tryPromise({
    try: () => response.json(),
    catch: () =>
      new CapabilityUnavailable({
        capability: 'billing',
        reason: `stripe responded ${response.status} with an unparseable body`
      })
  })
}

/**
 * One form-encoded Stripe API call, via the Workers global `fetch` — the REST
 * API needs no SDK, and keeping the dependency out keeps the worker bundle
 * small and the failure surface explicit. The call carries an `AbortSignal`
 * from `Effect.tryPromise` so interruption and the 10s deadline reach the
 * socket, and transport failures surface as typed `CapabilityUnavailable`
 * instead of defects. Exported for tests.
 */
export const createStripeCheckoutSession = Effect.fnUntraced(function* (input: {
  readonly secretKey: string
  readonly priceId: string
  readonly workspaceId: string
  readonly planId: string
  readonly successUrl: string
  readonly cancelUrl: string
}) {
  const response = yield* stripePost(
    'https://api.stripe.com/v1/checkout/sessions',
    {
      authorization: `Bearer ${input.secretKey}`,
      'content-type': 'application/x-www-form-urlencoded'
    },
    stripeCheckoutBody(input)
  )
  const json = yield* stripeJson(response)
  const decoded = decodeStripeCheckoutResponse(json)
  let message = `stripe responded ${response.status}`
  if (Result.isSuccess(decoded) && decoded.success.error?.message !== undefined) {
    message = decoded.success.error.message
  }
  if (Result.isFailure(decoded) || decoded.success.url === undefined) {
    return yield* Effect.fail(
      new CapabilityUnavailable({ capability: 'billing', reason: message })
    )
  }
  return { url: decoded.success.url }
})

// ---------------------------------------------------------------------------
// Stripe event → plan policy
// ---------------------------------------------------------------------------

/** How a handled Stripe event determines the workspace's new plan. */
export type StripeEventPlan =
  /** The plan rides in the event's `metadata.planId` (checkout sessions). */
  | { readonly kind: 'from_metadata' }
  /** The event pins one catalog plan (subscription deletions downgrade). */
  | { readonly kind: 'fixed'; readonly planId: string }

/**
 * The policy the background worker applies to inbound Stripe events: which
 * event types are billing-relevant, and what plan change each carries. Any
 * type absent from the table is ignored by the worker. Owned here so the
 * provider vocabulary and the plan catalog evolve together.
 */
const STRIPE_EVENT_PLANS = new Map<string, StripeEventPlan>([
  ['checkout.session.completed', { kind: 'from_metadata' }],
  ['customer.subscription.deleted', { kind: 'fixed', planId: STARTER_PLAN.id }]
])

/** Resolves the plan change an event type carries, or `null` when unhandled. */
export function planForStripeEvent(eventType: string): StripeEventPlan | null {
  return STRIPE_EVENT_PLANS.get(eventType) ?? null
}

// ---------------------------------------------------------------------------
// Webhook signature verification (shared with the background worker)
// ---------------------------------------------------------------------------

/**
 * Verifies Stripe's `stripe-signature` header scheme: `t=<ts>,v1=<hex>` where
 * `v1` is HMAC-SHA256 over `<ts>.<payload>` keyed with the webhook secret.
 * Constant-time comparison; `toleranceSeconds` bounds replay. Exported for
 * the background worker and its tests.
 */
// oxlint-disable-next-line effect/noAsyncFunction -- Web Crypto's HMAC API is promise-based, and this helper is shared with the background worker's plain fetch handler
export async function verifyStripeSignature(input: {
  readonly secret: string
  readonly payload: string
  readonly header: string | null
  readonly toleranceSeconds?: number | undefined
}): Promise<boolean> {
  if (input.header === null) {
    return false
  }
  const parts = new Map<string, string>()
  for (const pair of input.header.split(',')) {
    const [key, value] = pair.split('=', 2)
    if (key !== undefined && value !== undefined) {
      parts.set(key.trim(), value.trim())
    }
  }
  const timestamp = parts.get('t')
  const signature = parts.get('v1')
  if (timestamp === undefined || signature === undefined) {
    return false
  }
  // oxlint-disable-next-line effect/noGlobals -- replay tolerance is a wall-clock comparison by definition; Clock would tie a pure verification helper to an Effect runtime
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp))
  if (!Number.isFinite(age)) {
    return false
  }
  if (age > (input.toleranceSeconds ?? 300)) {
    return false
  }
  // oxlint-disable-next-line effect/noAsyncFunction -- Web Crypto awaits; see the note on the function
  const expected = await hmacSha256Hex(input.secret, `${timestamp}.${input.payload}`)
  if (expected.length !== signature.length) {
    return false
  }
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  return diff === 0
}
