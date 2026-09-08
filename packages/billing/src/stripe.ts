import { Effect, Result, Schema } from 'effect'

import { billingLifecycleStatuses } from '@b2b-saas-starter/db/enums'
import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { hmacSha256Hex } from './crypto.ts'

/**
 * The Stripe provider adapter: the hand-rolled REST client, the inbound event
 * policy, and the webhook signature verifier. `billing.ts` composes this into
 * the capability; the background worker imports the event policy and the
 * verifier directly for its raw `fetch` handler. Nothing here reaches for the
 * `Billing` service, so the entitlement gate in `plan-catalog.ts` stays
 * provider-free.
 */

/** Unix seconds through year 9999, leaving safe arithmetic space for lifecycle deadlines. */
export const StripeTimestamp = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: 253_402_300_799 })
)

/** The minimum provider fields consumed by the billing capability. */
const StripeSessionResponse = Schema.Struct({
  id: Schema.String,
  url: Schema.NullOr(Schema.String),
  customer: Schema.NullOr(Schema.String),
  subscription: Schema.NullOr(Schema.String),
  metadata: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  status: Schema.String,
  expires_at: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: 253_402_300_799 })
  )
})

type StripeSessionResponse = Schema.Schema.Type<typeof StripeSessionResponse>

// One compiled boundary decode: rebuilt once at module load, not per request.
const decodeStripeSessionResponse = Schema.decodeUnknownResult(StripeSessionResponse)

const StripePortalSessionResponse = Schema.Struct({
  id: Schema.String,
  url: Schema.String
})

const decodeStripePortalSessionResponse = Schema.decodeUnknownResult(
  StripePortalSessionResponse
)

const StripeCustomerResponse = Schema.Struct({
  id: Schema.String,
  deleted: Schema.optionalKey(Schema.Boolean),
  metadata: Schema.optionalKey(Schema.Record(Schema.String, Schema.String))
})

export type StripeCustomerResponse = Schema.Schema.Type<typeof StripeCustomerResponse>

export const StripePriceResponse = Schema.Struct({
  id: Schema.String,
  active: Schema.Boolean,
  currency: Schema.String,
  unit_amount: Schema.NullOr(Schema.Int),
  billing_scheme: Schema.String,
  transform_quantity: Schema.NullOr(Schema.Unknown),
  recurring: Schema.NullOr(
    Schema.Struct({
      interval: Schema.String,
      interval_count: Schema.Int,
      usage_type: Schema.String
    })
  )
})

const StripeSubscriptionItemResponse = Schema.Struct({
  id: Schema.String,
  quantity: Schema.Int,
  price: StripePriceResponse,
  current_period_start: StripeTimestamp,
  current_period_end: StripeTimestamp
})

const StripeSubscriptionResponse = Schema.Struct({
  id: Schema.String,
  customer: Schema.String,
  status: Schema.Literals(billingLifecycleStatuses),
  metadata: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  items: Schema.Struct({ data: Schema.Array(StripeSubscriptionItemResponse) }),
  cancel_at_period_end: Schema.Boolean,
  trial_end: Schema.NullOr(StripeTimestamp),
  latest_invoice: Schema.NullOr(Schema.String)
})

export type StripeSubscriptionResponse = Schema.Schema.Type<
  typeof StripeSubscriptionResponse
>

const StripeSubscriptionListResponse = Schema.Struct({
  data: Schema.Array(StripeSubscriptionResponse),
  has_more: Schema.Boolean
})

const decodeStripeCustomerResponse = Schema.decodeUnknownResult(StripeCustomerResponse)
const decodeStripeSubscriptionResponse = Schema.decodeUnknownResult(
  StripeSubscriptionResponse
)
const decodeStripeSubscriptionListResponse = Schema.decodeUnknownResult(
  StripeSubscriptionListResponse
)
const StripeCustomerSearchResponse = Schema.Struct({
  data: Schema.Array(StripeCustomerResponse),
  has_more: Schema.Boolean
})
const decodeStripeCustomerSearchResponse = Schema.decodeUnknownResult(
  StripeCustomerSearchResponse
)
const decodeStripeJson = Schema.decodeUnknownResult(
  Schema.fromJsonString(Schema.Unknown)
)

/** The form-encoded body Stripe's checkout-session endpoint expects. */
function stripeCheckoutBody(input: {
  readonly priceId: string
  readonly quantity: number
  readonly workspaceId: string
  readonly planId: string
  readonly customerId?: string | undefined
  readonly successUrl: string
  readonly cancelUrl: string
  readonly claimId?: string | undefined
}): string {
  const params = new URLSearchParams()
  params.set('mode', 'subscription')
  params.set('client_reference_id', input.workspaceId)
  params.set('success_url', input.successUrl)
  params.set('cancel_url', input.cancelUrl)
  params.set('line_items[0][price]', input.priceId)
  params.set('line_items[0][quantity]', String(input.quantity))
  if (input.customerId !== undefined) {
    params.set('customer', input.customerId)
  }
  params.set('metadata[workspaceId]', input.workspaceId)
  params.set('metadata[planId]', input.planId)
  if (input.claimId !== undefined) {
    params.set('metadata[claimId]', input.claimId)
  }
  params.set('subscription_data[metadata][workspaceId]', input.workspaceId)
  params.set('subscription_data[metadata][planId]', input.planId)
  return params.toString()
}

/** Deadline for one outbound provider call (Stripe or siteverify). */
const PROVIDER_TIMEOUT = '10 seconds'
const STRIPE_API_VERSION = '2025-03-31.basil'

/**
 * The Workers global `fetch` wrapped at the platform-adapter boundary: an HTTP
 * client dependency would add weight, not safety, to one form-encoded POST,
 * but the call still gets `Effect.tryPromise`'s `AbortSignal` so interruption
 * and deadlines reach the socket, and transport failures are classified as
 * typed `CapabilityUnavailable` instead of defects.
 */
function stripeUnavailable(reason: string): CapabilityUnavailable {
  return new CapabilityUnavailable({ capability: 'billing', reason })
}

type StripeHttpResponse = {
  readonly status: number
  readonly ok: boolean
  readonly body: string
}

function readStripeResponse(response: Response): Promise<StripeHttpResponse> {
  const status = response.status
  const ok = response.ok
  return response.text().then((responseBody) => ({ status, ok, body: responseBody }))
}

function stripePost(
  url: string,
  headers: Record<string, string>,
  body: string,
  idempotencyKey?: string
) {
  const requestHeaders = { ...headers }
  requestHeaders['stripe-version'] = STRIPE_API_VERSION
  if (idempotencyKey !== undefined) {
    requestHeaders['idempotency-key'] = idempotencyKey
  }
  return Effect.tryPromise({
    try: (signal) => {
      // oxlint-disable-next-line effect/noGlobals -- see docstring above
      const responsePromise = fetch(url, {
        method: 'POST',
        headers: requestHeaders,
        body,
        signal
      })
      return responsePromise.then(readStripeResponse)
    },
    catch: () => stripeUnavailable('stripe request failed')
  }).pipe(
    Effect.timeout(PROVIDER_TIMEOUT),
    // The deadline is the same "provider unreachable" failure the transport
    // path reports — never leak `TimeoutError` into the interface channel.
    Effect.catchTag('TimeoutError', () =>
      Effect.fail(stripeUnavailable('stripe request timed out'))
    )
  )
}

function stripeGet(url: string, headers: Record<string, string>) {
  return Effect.tryPromise({
    try: (signal) => {
      // oxlint-disable-next-line effect/noGlobals
      return fetch(url, {
        method: 'GET',
        headers: { ...headers, 'stripe-version': STRIPE_API_VERSION },
        signal
      }).then(readStripeResponse)
    },
    catch: () => stripeUnavailable('stripe request failed')
  }).pipe(
    Effect.timeout(PROVIDER_TIMEOUT),
    Effect.catchTag('TimeoutError', () =>
      Effect.fail(stripeUnavailable('stripe request timed out'))
    )
  )
}

function stripeJson(response: StripeHttpResponse) {
  const decoded = decodeStripeJson(response.body)
  if (Result.isFailure(decoded)) {
    return Effect.fail(stripeUnavailable(`stripe invalid response:${response.status}`))
  }
  return Effect.succeed(decoded.success)
}

/**
 * A URL-bearing session reply (checkout and Billing Portal share the shape),
 * decoded by the caller through the one boundary codec. Fails
 * `CapabilityUnavailable` with the provider's own message when it carried one.
 */
function stripeSessionUrl<T extends { readonly url?: string | undefined }>(
  decoded: Result.Result<T, unknown>,
  response: StripeHttpResponse
) {
  if (!response.ok) {
    return Effect.fail(stripeUnavailable(`stripe http:${response.status}`))
  }
  if (Result.isFailure(decoded) || decoded.success.url === undefined) {
    return Effect.fail(
      stripeUnavailable(`stripe invalid session response:${response.status}`)
    )
  }
  return Effect.succeed({ url: decoded.success.url })
}

export type StripeCheckoutSession = {
  readonly id: string
  readonly url: string | null
  readonly status: string
  readonly expiresAt: number
  readonly customer: string | null
  readonly subscription: string | null
  readonly metadata?: Readonly<Record<string, string>>
}

export type StripeCreatedCheckoutSession = Omit<StripeCheckoutSession, 'url'> & {
  readonly url: string
}

function normalizeStripeCheckoutSession(
  session: StripeSessionResponse
): StripeCheckoutSession {
  const normalized: StripeCheckoutSession = {
    id: session.id,
    url: session.url ?? null,
    status: session.status,
    expiresAt: session.expires_at,
    customer: session.customer ?? null,
    subscription: session.subscription ?? null
  }
  if (session.metadata === undefined) {
    return normalized
  }
  return { ...normalized, metadata: session.metadata }
}

function stripeCheckoutSession(
  decoded: Result.Result<StripeSessionResponse, unknown>,
  response: StripeHttpResponse
) {
  if (!response.ok) {
    return Effect.fail(stripeUnavailable(`stripe http:${response.status}`))
  }
  if (Result.isFailure(decoded)) {
    return Effect.fail(
      stripeUnavailable(`stripe invalid checkout response:${response.status}`)
    )
  }
  return Effect.succeed(normalizeStripeCheckoutSession(decoded.success))
}

function requireCheckoutUrl(
  session: StripeCheckoutSession,
  response: StripeHttpResponse
): Effect.Effect<StripeCreatedCheckoutSession, CapabilityUnavailable> {
  if (session.url === null) {
    return Effect.fail(
      stripeUnavailable(`stripe invalid checkout response:${response.status}`)
    )
  }
  return Effect.succeed({ ...session, url: session.url })
}

/**
 * One form-encoded Stripe API call, via the Workers global `fetch` — the REST
 * API needs no SDK, and keeping the dependency out keeps the worker bundle
 * small and the failure surface explicit. The call carries an `AbortSignal`
 * from `Effect.tryPromise` so interruption and the 10s deadline reach the
 * socket, and transport failures surface as typed `CapabilityUnavailable`
 * instead of defects. Exported for tests.
 */
export const createStripeCheckoutSession = Effect.fn('Stripe.createCheckoutSession')(
  function* (input: {
    readonly secretKey: string
    readonly priceId: string
    /**
     * The subscription item quantity checkout opens with: the workspace's
     * member count on a per-seat plan, `1` on a flat one.
     */
    readonly quantity: number
    readonly workspaceId: string
    readonly planId: string
    readonly customerId?: string | undefined
    readonly successUrl: string
    readonly cancelUrl: string
    /** Durable claim identity copied into Stripe metadata for recovery. */
    readonly claimId?: string | undefined
    /** Stable for a logical checkout attempt and reused after transport failure. */
    readonly idempotencyKey?: string | undefined
  }) {
    const response = yield* stripePost(
      'https://api.stripe.com/v1/checkout/sessions',
      {
        authorization: `Bearer ${input.secretKey}`,
        'content-type': 'application/x-www-form-urlencoded'
      },
      stripeCheckoutBody(input),
      input.idempotencyKey
    )
    const json = yield* stripeJson(response)
    return yield* requireCheckoutUrl(
      yield* stripeCheckoutSession(decodeStripeSessionResponse(json), response),
      response
    )
  }
)

/**
 * Creates a Stripe Billing Portal session for one customer: the hosted
 * surface where invoices, payment method, and cancellation are managed — the
 * starter deliberately owns none of those screens. Same transport, decode,
 * and failure contract as checkout; the reply shape is identical (`{ url }`).
 */
export const createStripeBillingPortalSession = Effect.fn(
  'Stripe.createBillingPortalSession'
)(function* (input: {
  readonly secretKey: string
  readonly customerId: string
  readonly returnUrl: string
  readonly idempotencyKey?: string | undefined
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
    params.toString(),
    input.idempotencyKey
  )
  const json = yield* stripeJson(response)
  return yield* stripeSessionUrl(decodeStripePortalSessionResponse(json), response)
})

/**
 * Sets one subscription item's quantity — the provider half of seat sync.
 * The reply is the updated SubscriptionItem object whose fields nothing here
 * reads, so only the status decides: non-2xx fails with the same typed
 * `CapabilityUnavailable` every Stripe call in this module fails with.
 */
export const updateStripeSubscriptionItemQuantity = Effect.fn(
  'Stripe.updateSubscriptionItemQuantity'
)(function* (input: {
  readonly secretKey: string
  readonly subscriptionItemId: string
  readonly quantity: number
  readonly idempotencyKey?: string | undefined
}) {
  const params = new URLSearchParams()
  params.set('quantity', String(input.quantity))
  params.set('proration_behavior', 'create_prorations')
  const response = yield* stripePost(
    `https://api.stripe.com/v1/subscription_items/${encodeURIComponent(input.subscriptionItemId)}`,
    {
      authorization: `Bearer ${input.secretKey}`,
      'content-type': 'application/x-www-form-urlencoded'
    },
    params.toString(),
    input.idempotencyKey
  )
  if (!response.ok) {
    return yield* Effect.fail(stripeUnavailable(`stripe http:${response.status}`))
  }
})

function stripeAuth(secretKey: string) {
  return { authorization: `Bearer ${secretKey}` }
}

function decodeStripe<T>(
  decoded: Result.Result<T, unknown>,
  reason: string
): Effect.Effect<T, CapabilityUnavailable> {
  if (Result.isSuccess(decoded)) {
    return Effect.succeed(decoded.success)
  }
  return Effect.fail(stripeUnavailable(reason))
}

function stripeResponse<T>(
  response: StripeHttpResponse,
  decoded: Result.Result<T, unknown>,
  operation: string
) {
  if (!response.ok) {
    return Effect.fail(stripeUnavailable(`stripe ${operation} http:${response.status}`))
  }
  return decodeStripe(decoded, `stripe ${operation} invalid response`)
}

/** Creates one customer. The caller must persist the returned id with the same key. */
export const createStripeCustomer = Effect.fn('Stripe.createCustomer')(
  function* (input: {
    readonly secretKey: string
    readonly workspaceId: string
    readonly idempotencyKey: string
    readonly email?: string | undefined
    readonly name?: string | undefined
  }) {
    const params = new URLSearchParams()
    params.set('metadata[workspaceId]', input.workspaceId)
    if (input.email !== undefined) {
      params.set('email', input.email)
    }
    if (input.name !== undefined) {
      params.set('name', input.name)
    }
    const response = yield* stripePost(
      'https://api.stripe.com/v1/customers',
      {
        ...stripeAuth(input.secretKey),
        'content-type': 'application/x-www-form-urlencoded'
      },
      params.toString(),
      input.idempotencyKey
    )
    const json = yield* stripeJson(response)
    return yield* stripeResponse(
      response,
      decodeStripeCustomerResponse(json),
      'customer.create'
    )
  }
)

/** Retrieves one customer and validates the response before exposing it. */
export const retrieveStripeCustomer = Effect.fn('Stripe.retrieveCustomer')(
  function* (input: { readonly secretKey: string; readonly customerId: string }) {
    const response = yield* stripeGet(
      `https://api.stripe.com/v1/customers/${encodeURIComponent(input.customerId)}`,
      stripeAuth(input.secretKey)
    )
    const json = yield* stripeJson(response)
    return yield* stripeResponse(
      response,
      decodeStripeCustomerResponse(json),
      'customer.retrieve'
    )
  }
)

/** Retrieves customers by workspace metadata for operator reconciliation. */
export const searchStripeCustomersByWorkspace = Effect.fn(
  'Stripe.searchCustomersByWorkspace'
)(function* (input: { readonly secretKey: string; readonly workspaceId: string }) {
  const escapedWorkspaceId = input.workspaceId
    .replaceAll(String.fromCharCode(92), String.fromCharCode(92, 92))
    .replaceAll("'", `${String.fromCharCode(92)}'`)
  const query = encodeURIComponent(`metadata['workspaceId']:'${escapedWorkspaceId}'`)
  const response = yield* stripeGet(
    `https://api.stripe.com/v1/customers/search?query=${query}&limit=100`,
    stripeAuth(input.secretKey)
  )
  const json = yield* stripeJson(response)
  return yield* stripeResponse(
    response,
    decodeStripeCustomerSearchResponse(json),
    'customer.search'
  )
})

/** A complete bounded list can prove absence when customer search is inconclusive. */
export const listStripeCustomersSince = Effect.fn('Stripe.listCustomersSince')(
  function* (input: { readonly secretKey: string; readonly createdAfter: number }) {
    const response = yield* stripeGet(
      `https://api.stripe.com/v1/customers?limit=100&created[gte]=${
        input.createdAfter
      }`,
      stripeAuth(input.secretKey)
    )
    const json = yield* stripeJson(response)
    return yield* stripeResponse(
      response,
      decodeStripeCustomerSearchResponse(json),
      'customer.list'
    )
  }
)

/** Retrieves a subscription with its first price and seat item expanded. */
export const retrieveStripeSubscription = Effect.fn('Stripe.retrieveSubscription')(
  function* (input: { readonly secretKey: string; readonly subscriptionId: string }) {
    const response = yield* stripeGet(
      `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(input.subscriptionId)}?expand[]=items.data.price`,
      stripeAuth(input.secretKey)
    )
    const json = yield* stripeJson(response)
    return yield* stripeResponse(
      response,
      decodeStripeSubscriptionResponse(json),
      'subscription.retrieve'
    )
  }
)

/** Lists all current and canceled subscriptions for one customer, bounded at 100. */
export const listStripeCustomerSubscriptions = Effect.fn(
  'Stripe.listCustomerSubscriptions'
)(function* (input: { readonly secretKey: string; readonly customerId: string }) {
  const customer = encodeURIComponent(input.customerId)
  const response = yield* stripeGet(
    `https://api.stripe.com/v1/subscriptions?customer=${customer}&status=all&limit=100&expand[]=data.items.data.price`,
    stripeAuth(input.secretKey)
  )
  const json = yield* stripeJson(response)
  return yield* stripeResponse(
    response,
    decodeStripeSubscriptionListResponse(json),
    'subscription.list'
  )
})

const StripeCheckoutSessionListResponse = Schema.Struct({
  data: Schema.Array(StripeSessionResponse),
  has_more: Schema.Boolean
})
const decodeStripeCheckoutSessionListResponse = Schema.decodeUnknownResult(
  StripeCheckoutSessionListResponse
)

/** Lists a customer's Checkout Sessions for bounded unknown-success recovery. */
export const listStripeCustomerCheckoutSessions = Effect.fn(
  'Stripe.listCustomerCheckoutSessions'
)(function* (input: { readonly secretKey: string; readonly customerId: string }) {
  const customer = encodeURIComponent(input.customerId)
  const response = yield* stripeGet(
    `https://api.stripe.com/v1/checkout/sessions?customer=${customer}&limit=100`,
    stripeAuth(input.secretKey)
  )
  const json = yield* stripeJson(response)
  const decoded = decodeStripeCheckoutSessionListResponse(json)
  return yield* stripeResponse(response, decoded, 'checkout_session.list').pipe(
    Effect.map((value) => {
      const data = value.data.map(normalizeStripeCheckoutSession)
      return { data, hasMore: value.has_more }
    })
  )
})

export type ValidatedStripeCustomer = {
  readonly customer: StripeCustomerResponse
  readonly subscriptions: ReadonlyArray<StripeSubscriptionResponse>
  readonly activeSubscriptions: ReadonlyArray<StripeSubscriptionResponse>
}

function activeSubscriptionStatus(status: string): boolean {
  return status !== 'canceled' && status !== 'incomplete_expired'
}

/**
 * Reads and validates the complete Stripe billing profile for one workspace.
 * Missing workspace metadata is an ownership conflict, and an incomplete
 * subscription list is never treated as proof that a second subscription is
 * safe.
 */
export const validateStripeCustomerForWorkspace = Effect.fn(
  'Stripe.validateCustomerForWorkspace'
)(function* (input: {
  readonly secretKey: string
  readonly customerId: string
  readonly workspaceId: string
  readonly knownSubscriptionId?: string | undefined
}) {
  const customer = yield* retrieveStripeCustomer(input)
  if (customer.deleted === true) {
    return yield* Effect.fail(stripeUnavailable('customer_deleted'))
  }
  if (customer.metadata?.workspaceId !== input.workspaceId) {
    return yield* Effect.fail(stripeUnavailable('customer_ownership_conflict'))
  }
  const listed = yield* listStripeCustomerSubscriptions(input)
  if (listed.has_more) {
    return yield* Effect.fail(stripeUnavailable('multiple_subscriptions'))
  }
  const activeSubscriptions = listed.data.filter(
    (subscription) =>
      subscription.status !== 'canceled' && subscription.status !== 'incomplete_expired'
  )
  if (
    activeSubscriptions.some(
      (subscription) =>
        subscription.customer !== input.customerId ||
        subscription.metadata?.workspaceId !== input.workspaceId
    )
  ) {
    return yield* Effect.fail(stripeUnavailable('subscription_ownership_conflict'))
  }
  if (activeSubscriptions.length > 1) {
    return yield* Effect.fail(stripeUnavailable('multiple_subscriptions'))
  }
  if (activeSubscriptions.length === 0 && input.knownSubscriptionId !== undefined) {
    const known = yield* retrieveStripeSubscription({
      secretKey: input.secretKey,
      subscriptionId: input.knownSubscriptionId
    })
    if (
      known.customer !== input.customerId ||
      known.metadata?.workspaceId !== input.workspaceId
    ) {
      return yield* Effect.fail(stripeUnavailable('subscription_ownership_conflict'))
    }
    if (activeSubscriptionStatus(known.status)) {
      return {
        customer,
        subscriptions: [...listed.data, known],
        activeSubscriptions: [known]
      }
    }
  }
  return { customer, subscriptions: listed.data, activeSubscriptions }
})

/** Retrieves a Checkout Session, including expiry and Stripe recovery fields. */
export const retrieveStripeCheckoutSession = Effect.fn(
  'Stripe.retrieveCheckoutSession'
)(function* (input: { readonly secretKey: string; readonly sessionId: string }) {
  const response = yield* stripeGet(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(input.sessionId)}`,
    stripeAuth(input.secretKey)
  )
  const json = yield* stripeJson(response)
  return yield* stripeCheckoutSession(decodeStripeSessionResponse(json), response)
})

// ---------------------------------------------------------------------------
// Stripe event → subscription state policy
// ---------------------------------------------------------------------------

/**
 * Routing hints carried by supported Stripe events. The billing capability
 * retrieves current provider state before changing linkage, seats, or plans.
 * Checkout events can omit the item, and subscription events can arrive
 * before checkout's customer linkage has been stored.
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
 * Stripe events: which event types carry
 * subscription linkage or a seat quantity, filled from the event object the
 * worker already decoded. Owned here so the provider vocabulary and the
 * seat-sync contract evolve together.
 */
const STRIPE_EVENT_SUBSCRIPTION_LINK_KINDS = new Set<string>([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'invoice.paid',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
  'invoice.payment_action_required',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted'
])

/** The subscription-event fields the policy reads, already decoded by the caller. */
type StripeSubscriptionEventObject = {
  /** The subscription's own id on `customer.subscription.*` events. */
  readonly id?: string | undefined
  readonly customer?: string | undefined
  /** The checkout session's subscription id on `checkout.session.completed`. */
  readonly subscription?: string | undefined
  readonly parent?:
    | {
        readonly subscription_details?: {
          readonly subscription?: string | undefined
        } | null
      }
    | null
    | undefined
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
  if (eventType.startsWith('invoice.')) {
    return {
      kind: 'link',
      customerId: object.customer,
      subscriptionId:
        object.parent?.subscription_details?.subscription ?? object.subscription
    }
  }
  const firstItem = object.items?.data?.[0]
  const quantity = firstItem?.quantity
  if (eventType.startsWith('customer.subscription.') && quantity !== undefined) {
    return {
      kind: 'quantity',
      customerId: object.customer,
      subscriptionId: object.id,
      subscriptionItemId: firstItem?.id,
      quantity
    }
  }
  let subscriptionId = object.id
  if (eventType.startsWith('checkout.')) {
    subscriptionId = object.subscription
  }
  return { kind: 'link', customerId: object.customer, subscriptionId }
}

// ---------------------------------------------------------------------------
// Webhook signature verification (shared with the background worker)
// ---------------------------------------------------------------------------

/**
 * Verifies Stripe's `stripe-signature` header scheme: `t=<ts>,v1=<hex>` where
 * `v1` is HMAC-SHA256 over `<ts>.<payload>` keyed with the webhook secret.
 * Constant-time comparison; `toleranceSeconds` bounds replay, measured on
 * the injectable `now` wall clock so tests can pin the boundary. Exported
 * for the background worker and its tests.
 */
// oxlint-disable-next-line effect/noAsyncFunction -- Web Crypto's HMAC API is promise-based, and this helper is shared with the background worker's plain fetch handler
export async function verifyStripeSignature(
  input: {
    readonly secret: string
    readonly payload: string
    readonly header: string | null
    readonly toleranceSeconds?: number | undefined
  },
  // oxlint-disable-next-line effect/noGlobals -- replay tolerance is a wall-clock comparison by definition; Clock would tie a pure verification helper to an Effect runtime
  now: () => number = Date.now
): Promise<boolean> {
  if (input.header === null) {
    return false
  }
  let timestamp: string | undefined
  const signatures: Array<string> = []
  for (const pair of input.header.split(',')) {
    const [key, value] = pair.split('=', 2)
    const trimmedKey = key?.trim()
    const trimmedValue = value?.trim()
    if (trimmedKey === 't' && trimmedValue !== undefined) {
      timestamp = trimmedValue
    } else if (trimmedKey === 'v1' && trimmedValue !== undefined) {
      signatures.push(trimmedValue)
    }
  }
  if (timestamp === undefined || signatures.length === 0) {
    return false
  }
  const age = Math.abs(Math.floor(now() / 1000) - Number(timestamp))
  if (!Number.isFinite(age)) {
    return false
  }
  if (age > (input.toleranceSeconds ?? 300)) {
    return false
  }
  // oxlint-disable-next-line effect/noAsyncFunction -- Web Crypto awaits; see the note on the function
  const expected = await hmacSha256Hex(input.secret, `${timestamp}.${input.payload}`)
  for (const signature of signatures) {
    if (expected.length !== signature.length) {
      continue
    }
    let diff = 0
    for (let i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
    }
    if (diff === 0) {
      return true
    }
  }
  return false
}

/** Shared decoded GET boundary for pricing and payment evidence. */
export const readStripeObject = Effect.fn('Stripe.readObject')(function* <A>(
  secretKey: string,
  path: string,
  schema: Schema.Codec<A>
) {
  const response = yield* stripeGet(
    `https://api.stripe.com/v1/${path}`,
    stripeAuth(secretKey)
  )
  const json = yield* stripeJson(response)
  return yield* stripeResponse(
    response,
    Schema.decodeUnknownResult(schema)(json),
    path.split('?')[0] ?? path
  )
})
