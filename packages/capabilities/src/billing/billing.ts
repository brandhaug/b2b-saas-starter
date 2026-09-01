import { workspaces, type JsonObject } from '@b2b-saas-starter/db/schema'
import { Database, type RawD1 } from '@b2b-saas-starter/db/service'
import { Context, Effect, Layer, Ref } from 'effect'
import { eq } from 'drizzle-orm'

import { CapabilityUnavailable } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { auditedMutations } from '../governance/audited-mutation.ts'
import { planById, PLANS, type Plan } from './plan-catalog.ts'
import { createStripeCheckoutSession } from './stripe.ts'

/**
 * The Billing capability: the workspace's plan, the checkout handoff, and the
 * provider-reported plan change. The plan catalog and its entitlement gate
 * live in [`plan-catalog.ts`](./plan-catalog.ts); the Stripe REST client,
 * event policy, and signature verifier live in [`stripe.ts`](./stripe.ts).
 */

/** The audit metadata for a plan change: the plan plus any provider detail. */
function planChangeMetadata(planId: string, detail?: JsonObject): JsonObject {
  const metadata: JsonObject = { planId }
  if (detail === undefined) {
    return metadata
  }
  return { ...metadata, ...detail }
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
  /**
   * Whether checkout is actually wired: the Stripe secret key is set and
   * every self-serve plan's price id is configured. One definition of
   * "Stripe is configured" — the UI reads this instead of re-deriving it
   * from env, so the page cannot say "not configured" while checkout runs.
   */
  readonly configured: Effect.Effect<boolean>
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
        configured: Effect.succeed(configured),
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
            if (!known) {
              return false
            }
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
   * the `stripePriceEnv` var each plan names). A plan without an entry has no
   * self-serve checkout — Starter needs none and Enterprise is sold.
   */
  readonly priceIds?: Readonly<Record<string, string>> | undefined
}

/**
 * One definition of "Stripe is configured": the secret key is set and every
 * plan that carries a price env var has a price id configured. This is the
 * same predicate `startCheckout` enforces — a surface reporting
 * `configured: true` cannot then run into `provider_not_configured` or
 * `price_not_configured`.
 */
function billingConfigured(options: LiveBillingOptions): boolean {
  if (options.secretKey === undefined || options.secretKey.length === 0) {
    return false
  }
  return PLANS.every((plan) => {
    if (plan.stripePriceEnv === null) {
      return true
    }
    const priceId = options.priceIds?.[plan.id]
    return priceId !== undefined && priceId.length > 0
  })
}

export function LiveBilling(
  options: LiveBillingOptions = {}
): Layer.Layer<Billing, never, Database | RawD1 | AuditEventLog> {
  return Layer.effect(Billing)(
    Effect.gen(function* () {
      const db = yield* Database
      const audit = yield* AuditEventLog
      const unavailable = orUnavailable('billing')
      // The shared mutate+audit combinator — one implementation of the batched
      // write, its zero-match skip, and the phantom-audit caveat (see
      // governance/audited-mutation.ts).
      const auditedMutation = yield* auditedMutations({
        prepareAuditRecord: audit.prepareRecord,
        unavailable
      })

      return {
        configured: Effect.succeed(billingConfigured(options)),
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
            const priceEnvName = planById(input.planId).stripePriceEnv
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
            if (!PLANS.some((plan) => plan.id === input.planId)) {
              return false
            }
            // Resolve first, then write: an unknown workspace id yields `false`
            // without writing a system audit event for a row that does not
            // exist. That pre-check is the combinator's `matched`, so the
            // update and its audit insert commit or roll back as one.
            return yield* auditedMutation({
              matched: unavailable(
                db
                  .select({ id: workspaces.id })
                  .from(workspaces)
                  .where(eq(workspaces.id, input.workspaceId))
                  .limit(1)
              ).pipe(Effect.map((rows) => rows.length > 0)),
              auditEvent: {
                // A system event: the actor is the provider webhook, not a user.
                workspaceId: input.workspaceId,
                actorUserId: null,
                eventType: 'billing.plan_changed',
                targetType: 'workspace',
                targetId: input.workspaceId,
                metadata: planChangeMetadata(input.planId, input.detail)
              },
              write: () =>
                db
                  .update(workspaces)
                  .set({ planId: input.planId })
                  .where(eq(workspaces.id, input.workspaceId))
            })
          })
      }
    })
  )
}
