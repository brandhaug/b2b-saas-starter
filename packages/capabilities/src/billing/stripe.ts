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

/** The part of Stripe's session-shaped reply this capability acts on. */
const StripeSessionResponse = Schema.Struct({
  url: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(
    Schema.Struct({ message: Schema.optionalKey(Schema.String) })
  )
})

// One compiled boundary decode: rebuilt once at module load, not per request.
const decodeStripeSessionResponse = Schema.decodeUnknownResult(StripeSessionResponse)

/** The form-encoded body Stripe's checkout-session endpoint expects. */
function stripeCheckoutBody(input: {
  readonly priceId: string
  readonly quantity: number
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
  params.set('line_items[0][quantity]', String(input.quantity))
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
 * A URL-bearing session reply (checkout and Billing Portal share the shape),
 * decoded by the caller through the one boundary codec. Fails
 * `CapabilityUnavailable` with the provider's own message when it carried one.
 */
function stripeSessionUrl(
  decoded: ReturnType<typeof decodeStripeSessionResponse>,
  response: Response
) {
  let message = `stripe responded ${response.status}`
  if (Result.isSuccess(decoded) && decoded.success.error?.message !== undefined) {
    message = decoded.success.error.message
  }
  if (Result.isFailure(decoded) || decoded.success.url === undefined) {
    return Effect.fail(
      new CapabilityUnavailable({ capability: 'billing', reason: message })
    )
  }
  return Effect.succeed({ url: decoded.success.url })
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
  /**
   * The subscription item quantity checkout opens with: the workspace's
   * member count on a per-seat plan, `1` on a flat one.
   */
  readonly quantity: number
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
  return yield* stripeSessionUrl(decodeStripeSessionResponse(json), response)
})

/**
 * Creates a Stripe Billing Portal session for one customer: the hosted
 * surface where invoices, payment method, and cancellation are managed — the
 * starter deliberately owns none of those screens. Same transport, decode,
 * and failure contract as checkout; the reply shape is identical (`{ url }`).
 */
export const createStripeBillingPortalSession = Effect.fnUntraced(function* (input: {
  readonly secretKey: string
  readonly customerId: string
  readonly returnUrl: string
}) {
  const params = new URLSearchParams()
  params.set('customer', input.customerId)
  params.set('return_url', input.returnUrl)
  const response = yield* stripePost(
    'https://api.stripe.com/v1/billing_portal/sessions',
    {
      authorization: `Bearer ${input.secretKey}`,
      'content-type': 'application/x-www-form-urlencoded'
    },
    params.toString()
  )
  const json = yield* stripeJson(response)
  return yield* stripeSessionUrl(decodeStripeSessionResponse(json), response)
})

/**
 * Sets one subscription item's quantity — the provider half of seat sync.
 * The reply is the updated SubscriptionItem object whose fields nothing here
 * reads, so only the status decides: non-2xx fails with the same typed
 * `CapabilityUnavailable` every Stripe call in this module fails with.
 */
export const updateStripeSubscriptionItemQuantity = Effect.fnUntraced(
  function* (input: {
    readonly secretKey: string
    readonly subscriptionItemId: string
    readonly quantity: number
  }) {
    const params = new URLSearchParams()
    params.set('quantity', String(input.quantity))
    const response = yield* stripePost(
      `https://api.stripe.com/v1/subscription_items/${encodeURIComponent(input.subscriptionItemId)}`,
      {
        authorization: `Bearer ${input.secretKey}`,
        'content-type': 'application/x-www-form-urlencoded'
      },
      params.toString()
    )
    if (!response.ok) {
      return yield* Effect.fail(
        new CapabilityUnavailable({
          capability: 'billing',
          reason: `stripe responded ${response.status}`
        })
      )
    }
  }
)

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
// Stripe event → subscription state policy
// ---------------------------------------------------------------------------

/**
 * The provider-reported subscription state one handled Stripe event carries:
 * the linkage a checkout establishes, the quantity a subscription event
 * reports (the reconciliation source of truth for seat sync), or a deletion
 * (the seat item goes; the customer survives for the portal's invoice
 * history). Fields the event may omit are optional — `checkout.session
 * .completed` carries no item, and a subscription event can arrive before the
 * checkout's link was recorded.
 */
export type StripeSubscriptionLink =
  | {
      readonly kind: 'link'
      readonly customerId?: string | undefined
      readonly subscriptionId?: string | undefined
    }
  | {
      readonly kind: 'quantity'
      readonly customerId?: string | undefined
      readonly subscriptionId?: string | undefined
      readonly subscriptionItemId?: string | undefined
      readonly quantity: number
    }
  | { readonly kind: 'deleted' }

/**
 * The subscription-state policy the background worker applies to inbound
 * Stripe events, beside {@link planForStripeEvent}: which event types carry
 * subscription linkage or a seat quantity, filled from the event object the
 * worker already decoded. Owned here so the provider vocabulary and the
 * seat-sync contract evolve together.
 */
const STRIPE_EVENT_SUBSCRIPTION_LINK_KINDS = new Set<string>([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted'
])

/** The subscription-event fields the policy reads, already decoded by the caller. */
export type StripeSubscriptionEventObject = {
  /** The subscription's own id on `customer.subscription.*` events. */
  readonly id?: string | undefined
  readonly customer?: string | undefined
  /** The checkout session's subscription id on `checkout.session.completed`. */
  readonly subscription?: string | undefined
  /** Stripe's line-item list; the starter bills exactly one seat item. */
  readonly items?:
    | {
        readonly data?: ReadonlyArray<
          | { readonly id?: string | undefined; readonly quantity?: number | undefined }
          | undefined
        >
      }
    | undefined
}

/**
 * Resolves the subscription state one event carries, or `null` when the event
 * type is not subscription-relevant. A `quantity` event whose item carries no
 * quantity degrades to `link` — ids are still worth recording, and a quantity
 * write with nothing to write would be a lie.
 */
export function subscriptionLinkForStripeEvent(
  eventType: string,
  object: StripeSubscriptionEventObject
): StripeSubscriptionLink | null {
  if (eventType === 'customer.subscription.deleted') {
    return { kind: 'deleted' }
  }
  if (!STRIPE_EVENT_SUBSCRIPTION_LINK_KINDS.has(eventType)) {
    return null
  }
  const firstItem = object.items?.data?.[0]
  const quantity = firstItem?.quantity
  if (eventType !== 'checkout.session.completed' && quantity !== undefined) {
    return {
      kind: 'quantity',
      customerId: object.customer,
      subscriptionId: object.id,
      subscriptionItemId: firstItem?.id,
      quantity
    }
  }
  return {
    kind: 'link',
    customerId: object.customer,
    subscriptionId: object.subscription ?? object.id
  }
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
