import { workspaces, type JsonObject } from '@b2b-saas-starter/db/schema'
import {
  batch,
  Database,
  type EffectDatabase,
  RawD1
} from '@b2b-saas-starter/db/service'
import { Context, Effect, Layer, Ref, Result, Schema } from 'effect'
import { count, eq, type SQL } from 'drizzle-orm'
import { type SQLiteTable } from 'drizzle-orm/sqlite-core'

import { CapabilityUnavailable, PlanLimitExceeded } from '../errors.ts'
import { hmacSha256Hex } from '../internal/crypto.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { AuditEventLog } from '../governance/audit-event-log.ts'

/**
 * The plan catalog. A constant, not a service method: plans are part of the
 * starter's vocabulary (the public pricing page and the workspace billing page
 * render the same list), and no database table owns them. `planId` on a
 * workspace row is the entitlement state; this catalog gives that id a shape.
 */
export type Plan = {
  readonly id: string
  readonly name: string
  readonly price: string
  readonly description: string
  /**
   * Per-resource entitlement ceilings. `null` means unlimited. The starter
   * plan carries real numbers so entitlement gating is demonstrable without a
   * provider; paid plans do not constrain.
   */
  readonly limits: {
    readonly apiTokens: number | null
    readonly webhookEndpoints: number | null
  }
}

/** The free tier every workspace starts on and every downgrade lands on. */
export const STARTER_PLAN: Plan = {
  id: 'starter',
  name: 'Starter',
  price: '$0',
  description: 'Local development and reference implementation review.',
  limits: { apiTokens: 2, webhookEndpoints: 1 }
}

export const PLANS: readonly Plan[] = [
  STARTER_PLAN,
  {
    id: 'team',
    name: 'Team',
    price: '$49/mo',
    description: 'The shape most B2B SaaS products adapt first.',
    limits: { apiTokens: null, webhookEndpoints: null }
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'Custom',
    description: 'SAML, procurement, custom compliance, and support patterns.',
    limits: { apiTokens: null, webhookEndpoints: null }
  }
]

/** Resolves a plan id from the catalog; unknown ids fall back to Starter. */
export function planById(planId: string): Plan {
  return PLANS.find((plan) => plan.id === planId) ?? STARTER_PLAN
}

/** The audit metadata for a plan change: the plan plus any provider detail. */
function planChangeMetadata(planId: string, detail?: JsonObject): JsonObject {
  const metadata: JsonObject = { planId }
  if (detail === undefined) return metadata
  return { ...metadata, ...detail }
}

/** Entitlement resources a plan can cap. */
export type EntitlementResource = 'api_token' | 'webhook_endpoint'

function limitFor(plan: Plan, resource: EntitlementResource): number | null {
  if (resource === 'api_token') return plan.limits.apiTokens
  return plan.limits.webhookEndpoints
}

/**
 * Entitlement gate over the workspace in context. Pure composition — it reads
 * the resolved workspace's `planId` and compares `used` against the plan's
 * ceiling. The mutating capabilities compose this themselves (counting their
 * own rows), so callers cannot forget the gate and no route handler or server
 * function re-derives the idiom.
 */
export const assertWithinPlanLimit = Effect.fnUntraced(function* (input: {
  readonly resource: EntitlementResource
  readonly used: number
}) {
  const ctx = yield* WorkspaceContext
  const plan = planById(ctx.workspace.planId)
  const limit = limitFor(plan, input.resource)
  if (limit !== null && input.used >= limit) {
    return yield* Effect.fail(
      new PlanLimitExceeded({
        planId: plan.id,
        resource: input.resource,
        limit
      })
    )
  }
})

/**
 * The entitlement gate with its counting query beside it: counts the rows of
 * `table` matching `where` in the caller's store and asserts the workspace in
 * context is within the plan ceiling. Both mutating capabilities compose this,
 * so the "count active rows → compare against the plan" idiom exists once.
 */
export function assertWithinPlanLimitFor(input: {
  readonly resource: EntitlementResource
  readonly db: EffectDatabase
  /** Which capability name surfaces on a `CapabilityUnavailable` count failure. */
  readonly capability: string
  readonly table: SQLiteTable
  readonly where?: SQL | undefined
}): Effect.Effect<void, CapabilityUnavailable | PlanLimitExceeded, WorkspaceContext> {
  return Effect.gen(function* () {
    const rows = yield* orUnavailable(input.capability)(
      input.db.select({ value: count() }).from(input.table).where(input.where)
    )
    yield* assertWithinPlanLimit({
      resource: input.resource,
      used: rows[0]?.value ?? 0
    })
  })
}

/** The checkout handoff: where Stripe should send the browser afterwards. */
export type CheckoutInput = {
  readonly planId: string
  readonly successUrl: string
  readonly cancelUrl: string
}

export type CheckoutSession = {
  /** The Stripe-hosted URL to redirect the browser to. */
  readonly url: string
}

export type BillingInterface = {
  /** The workspace's current plan, resolved from its `planId`. */
  readonly currentPlan: Effect.Effect<Plan, CapabilityUnavailable, WorkspaceContext>
  /**
   * Starts a Stripe Checkout session for one catalog plan and returns the
   * hosted URL. Fails `CapabilityUnavailable` (`provider_not_configured`) when
   * the Stripe env is unset — the honest degraded posture, not an exception —
   * and records a `billing.checkout_started` audit event on success.
   */
  readonly startCheckout: (
    input: CheckoutInput
  ) => Effect.Effect<CheckoutSession, CapabilityUnavailable, WorkspaceContext>
  /**
   * Applies a provider-reported subscription change to one workspace:
   * updates `workspaces.planId` and writes the matching audit event
   * atomically. Identity-keyed — inbound webhooks carry no session, so there
   * is no `WorkspaceContext` — and returns `false` for an unknown workspace
   * id instead of failing, mirroring how a revoked token verifies.
   */
  readonly applyProviderEvent: (input: {
    readonly workspaceId: string
    readonly planId: string
    /** Free-form detail for the audit metadata (event id, subscription id). */
    readonly detail?: JsonObject | undefined
  }) => Effect.Effect<boolean, CapabilityUnavailable>
}

export class Billing extends Context.Service<Billing, BillingInterface>()(
  '@b2b-saas-starter/capabilities/Billing'
) {}

// ---------------------------------------------------------------------------
// Seed layer
// ---------------------------------------------------------------------------

/**
 * In-memory billing. `stripeConfigured` mirrors the env gate: `false` makes
 * `startCheckout` fail exactly like the Live layer does with unset vars, so
 * tests exercise the degraded path without a provider.
 */
export function SeedBilling(options?: {
  readonly stripeConfigured?: boolean | undefined
}): Layer.Layer<Billing, never, AuditEventLog> {
  return Layer.effect(Billing)(
    Effect.gen(function* () {
      const audit = yield* AuditEventLog
      const configured = options?.stripeConfigured ?? false

      // Local mutation of the fixture workspace's planId, read back by
      // `currentPlan` — same read-your-write shape as Live.
      const planOverrides = yield* Ref.make<ReadonlyMap<string, string>>(new Map())

      return {
        currentPlan: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const overrides = yield* Ref.get(planOverrides)
          return planById(overrides.get(ctx.workspace.id) ?? ctx.workspace.planId)
        }),
        startCheckout: (input) =>
          Effect.gen(function* () {
            if (!configured) {
              return yield* Effect.fail(
                new CapabilityUnavailable({
                  capability: 'billing',
                  reason: 'provider_not_configured'
                })
              )
            }
            const ctx = yield* WorkspaceContext
            const url = `https://checkout.stripe.com/c/pay/test_${input.planId}`
            yield* audit.record({
              workspaceId: ctx.workspace.id,
              actorUserId: ctx.actor?.userId ?? null,
              eventType: 'billing.checkout_started',
              targetType: 'workspace',
              targetId: ctx.workspace.id,
              metadata: { planId: input.planId }
            })
            return { url }
          }),
        applyProviderEvent: (input) =>
          Effect.gen(function* () {
            const known = PLANS.some((plan) => plan.id === input.planId)
            if (!known) return false
            yield* Ref.update(planOverrides, (map) => {
              const next = new Map(map)
              next.set(input.workspaceId, input.planId)
              return next
            })
            yield* audit.record({
              // A system event: the actor is the provider webhook, not a user.
              workspaceId: input.workspaceId,
              actorUserId: null,
              eventType: 'billing.plan_changed',
              targetType: 'workspace',
              targetId: input.workspaceId,
              metadata: planChangeMetadata(input.planId, input.detail)
            })
            return true
          })
      }
    })
  )
}

// ---------------------------------------------------------------------------
// Live layer
// ---------------------------------------------------------------------------

export type LiveBillingOptions = {
  /**
   * `STRIPE_SECRET_KEY`. Absent, checkout fails
   * `CapabilityUnavailable('provider_not_configured')` and every other
   * surface keeps working — provider-light degradation (CLAUDE.md rule 3).
   */
  readonly secretKey?: string | undefined
  /**
   * Stripe price ids per plan id (e.g. `{ team: 'price_...' }`, sourced from
   * the `STRIPE_PRICE_ID_<PLAN>` env vars). A plan without an entry has no
   * self-serve checkout — Starter needs none and Enterprise is sold.
   */
  readonly priceIds?: Readonly<Record<string, string>> | undefined
}

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

/**
 * Maps a plan id onto the Stripe price env var the deploy must configure.
 * Only paid self-serve plans have one; the starter plan needs no checkout and
 * enterprise is sold, not self-served.
 */
export function stripePriceEnvName(planId: string): string | null {
  if (planId === 'team') return 'STRIPE_PRICE_ID_TEAM'
  return null
}

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

export function LiveBilling(
  options: LiveBillingOptions = {}
): Layer.Layer<Billing, never, Database | RawD1 | AuditEventLog> {
  return Layer.effect(Billing)(
    Effect.gen(function* () {
      const db = yield* Database
      const d1 = yield* RawD1
      const audit = yield* AuditEventLog
      const unavailable = orUnavailable('billing')

      return {
        currentPlan: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const rows = yield* unavailable(
            db
              .select({ planId: workspaces.planId })
              .from(workspaces)
              .where(eq(workspaces.id, ctx.workspace.id))
              .limit(1)
          )
          return planById(rows[0]?.planId ?? ctx.workspace.planId)
        }),
        startCheckout: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            if (options.secretKey === undefined || options.secretKey.length === 0) {
              return yield* Effect.fail(
                new CapabilityUnavailable({
                  capability: 'billing',
                  reason: 'provider_not_configured'
                })
              )
            }
            const priceEnvName = stripePriceEnvName(input.planId)
            let priceId: string | undefined
            if (priceEnvName === null) {
              priceId = undefined
            } else {
              priceId = options.priceIds?.[input.planId]
            }
            if (priceId === undefined || priceId.length === 0) {
              return yield* Effect.fail(
                new CapabilityUnavailable({
                  capability: 'billing',
                  reason: `price_not_configured:${priceEnvName ?? input.planId}`
                })
              )
            }
            const session = yield* createStripeCheckoutSession({
              secretKey: options.secretKey,
              priceId,
              workspaceId: ctx.workspace.id,
              planId: input.planId,
              successUrl: input.successUrl,
              cancelUrl: input.cancelUrl
            })
            yield* audit.record({
              workspaceId: ctx.workspace.id,
              actorUserId: ctx.actor?.userId ?? null,
              eventType: 'billing.checkout_started',
              targetType: 'workspace',
              targetId: ctx.workspace.id,
              metadata: { planId: input.planId }
            })
            return session
          }),
        applyProviderEvent: (input) =>
          Effect.gen(function* () {
            if (!PLANS.some((plan) => plan.id === input.planId)) return false
            // Resolve first, then write: an unknown workspace id yields `false`
            // without writing a system audit event for a row that does not
            // exist. The two statements below are not atomic with the read,
            // but the update is keyed by id and idempotent, and the audit
            // batch commits or rolls back as one — the same accepted shape as
            // the other read-then-write capabilities.
            const existing = yield* unavailable(
              db
                .select({ id: workspaces.id })
                .from(workspaces)
                .where(eq(workspaces.id, input.workspaceId))
                .limit(1)
            )
            if (existing.length === 0) return false
            const auditRecorded = yield* audit.prepareRecord({
              // A system event: the actor is the provider webhook, not a user.
              workspaceId: input.workspaceId,
              actorUserId: null,
              eventType: 'billing.plan_changed',
              targetType: 'workspace',
              targetId: input.workspaceId,
              metadata: planChangeMetadata(input.planId, input.detail)
            })
            yield* unavailable(
              batch(d1, [
                db
                  .update(workspaces)
                  .set({ planId: input.planId })
                  .where(eq(workspaces.id, input.workspaceId)),
                auditRecorded
              ])
            )
            return true
          })
      }
    })
  )
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
  if (input.header === null) return false
  const parts = new Map<string, string>()
  for (const pair of input.header.split(',')) {
    const [key, value] = pair.split('=', 2)
    if (key !== undefined && value !== undefined) parts.set(key.trim(), value.trim())
  }
  const timestamp = parts.get('t')
  const signature = parts.get('v1')
  if (timestamp === undefined || signature === undefined) return false
  // oxlint-disable-next-line effect/noGlobals -- replay tolerance is a wall-clock comparison by definition; Clock would tie a pure verification helper to an Effect runtime
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp))
  if (!Number.isFinite(age)) return false
  if (age > (input.toleranceSeconds ?? 300)) return false
  // oxlint-disable-next-line effect/noAsyncFunction -- Web Crypto awaits; see the note on the function
  const expected = await hmacSha256Hex(input.secret, `${timestamp}.${input.payload}`)
  if (expected.length !== signature.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  return diff === 0
}
