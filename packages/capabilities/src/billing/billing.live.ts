import {
  workspaceMembers,
  workspaces,
  workspaceSubscriptions
} from '@b2b-saas-starter/db/schema'
import { Database, type RawD1 } from '@b2b-saas-starter/db/service'
import { DateTime, Effect, Layer } from 'effect'
import { count, eq } from 'drizzle-orm'

import { CapabilityUnavailable } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { auditedMutations } from '../governance/audited-mutation.ts'
import { planById, PLANS } from './plan-catalog.ts'
import {
  Billing,
  planChangeMetadata,
  seatChangeMetadata,
  type ApplySubscriptionEventInput
} from './billing.ts'
import {
  createStripeBillingPortalSession,
  createStripeCheckoutSession,
  updateStripeSubscriptionItemQuantity
} from './stripe.ts'

/**
 * The D1-backed billing adapter: plan reads off `workspaces.planId`,
 * subscription linkage off `workspace_subscriptions`, and the provider calls
 * (`stripe.ts`) for checkout, the Billing Portal, and seat-quantity updates.
 */

export type LiveBillingOptions = {
  /**
   * `STRIPE_SECRET_KEY`. Absent, checkout and the portal fail
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

function providerNotConfigured(): CapabilityUnavailable {
  return new CapabilityUnavailable({
    capability: 'billing',
    reason: 'provider_not_configured'
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

      /** Counts the workspace's members — the seat quantity a per-seat plan bills. */
      const countMembers = Effect.fnUntraced(function* (workspaceId: string) {
        const rows = yield* unavailable(
          db
            .select({ value: count() })
            .from(workspaceMembers)
            .where(eq(workspaceMembers.workspaceId, workspaceId))
        )
        return rows[0]?.value ?? 0
      })

      const readSubscription = Effect.fnUntraced(function* (workspaceId: string) {
        const rows = yield* unavailable(
          db
            .select()
            .from(workspaceSubscriptions)
            .where(eq(workspaceSubscriptions.workspaceId, workspaceId))
            .limit(1)
        )
        return rows[0]
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
            const secretKey = options.secretKey
            if (secretKey === undefined || secretKey.length === 0) {
              return yield* Effect.fail(providerNotConfigured())
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
            const plan = planById(input.planId)
            let quantity = 1
            if (plan.pricing === 'per_seat') {
              quantity = yield* countMembers(ctx.workspace.id)
            }
            const session = yield* createStripeCheckoutSession({
              secretKey,
              priceId,
              quantity,
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
              metadata: { planId: input.planId, quantity }
            })
            return session
          }),
        startPortalSession: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const secretKey = options.secretKey
            if (secretKey === undefined || secretKey.length === 0) {
              return yield* Effect.fail(providerNotConfigured())
            }
            const row = yield* readSubscription(ctx.workspace.id)
            if (row === undefined) {
              return yield* Effect.fail(
                new CapabilityUnavailable({
                  capability: 'billing',
                  reason: 'no_billing_profile'
                })
              )
            }
            const session = yield* createStripeBillingPortalSession({
              secretKey,
              customerId: row.stripeCustomerId,
              returnUrl: input.returnUrl
            })
            yield* audit.record({
              workspaceId: ctx.workspace.id,
              actorUserId: ctx.actor?.userId ?? null,
              eventType: 'billing.portal_opened',
              targetType: 'workspace',
              targetId: ctx.workspace.id,
              metadata: {}
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
          }),
        applySubscriptionEvent: (input: ApplySubscriptionEventInput) =>
          Effect.gen(function* () {
            const known = yield* unavailable(
              db
                .select({ id: workspaces.id })
                .from(workspaces)
                .where(eq(workspaces.id, input.workspaceId))
                .limit(1)
            )
            if (known.length === 0) {
              return false
            }
            const existing = yield* readSubscription(input.workspaceId)
            const customerId = input.customerId ?? existing?.stripeCustomerId
            // Nothing to record: the event carries no customer and no row
            // holds one — the Seed adapter answers the same input `false`.
            if (customerId === undefined) {
              return false
            }
            const deleted = input.deleted === true
            let quantity = input.quantity ?? existing?.seatQuantity ?? 0
            if (deleted) {
              quantity = 0
            }
            let subscriptionId: string | null = null
            let subscriptionItemId: string | null = null
            if (!deleted) {
              subscriptionId =
                input.subscriptionId ?? existing?.stripeSubscriptionId ?? null
              subscriptionItemId =
                input.subscriptionItemId ?? existing?.stripeSubscriptionItemId ?? null
            }
            const values = {
              stripeCustomerId: customerId,
              stripeSubscriptionId: subscriptionId,
              stripeSubscriptionItemId: subscriptionItemId,
              seatQuantity: quantity,
              updatedAt: DateTime.formatIso(yield* DateTime.now)
            }
            function write() {
              if (existing === undefined) {
                return db
                  .insert(workspaceSubscriptions)
                  .values({ workspaceId: input.workspaceId, ...values })
              }
              return db
                .update(workspaceSubscriptions)
                .set(values)
                .where(eq(workspaceSubscriptions.workspaceId, input.workspaceId))
            }
            // The audit rides only a quantity that actually moved — a link
            // refresh or an item id arriving late is not a seat change.
            const moved =
              (input.quantity !== undefined || deleted) &&
              (existing?.seatQuantity ?? 0) !== quantity
            if (!moved) {
              yield* unavailable(write())
              return true
            }
            return yield* auditedMutation({
              matched: Effect.succeed(existing !== undefined),
              auditEvent: {
                workspaceId: input.workspaceId,
                actorUserId: null,
                eventType: 'billing.seats_changed',
                targetType: 'workspace',
                targetId: input.workspaceId,
                metadata: seatChangeMetadata(quantity, input.detail)
              },
              write
            })
          }),
        syncSeats: (input) =>
          Effect.gen(function* () {
            // Workspace state is checked before the provider gate, so a
            // workspace that never checked out answers `no_subscription`
            // whether or not Stripe is configured on this deployment.
            const row = yield* readSubscription(input.workspaceId)
            if (row === undefined) {
              return { outcome: 'no_subscription', quantity: null }
            }
            if (row.stripeSubscriptionItemId === null) {
              return { outcome: 'no_seat_item', quantity: null }
            }
            const members = yield* countMembers(input.workspaceId)
            if (row.seatQuantity === members) {
              return { outcome: 'quantity_unchanged', quantity: members }
            }
            const secretKey = options.secretKey
            if (secretKey === undefined || secretKey.length === 0) {
              return { outcome: 'provider_not_configured', quantity: null }
            }
            // The provider call stands outside the batch on purpose: the
            // stored quantity records what Stripe acknowledged, so a failed
            // update leaves both the row and the audit unwritten and the
            // queue retries the whole message.
            yield* updateStripeSubscriptionItemQuantity({
              secretKey,
              subscriptionItemId: row.stripeSubscriptionItemId,
              quantity: members
            })
            const updatedAt = DateTime.formatIso(yield* DateTime.now)
            yield* auditedMutation({
              matched: Effect.succeed(true),
              auditEvent: {
                workspaceId: input.workspaceId,
                actorUserId: null,
                eventType: 'billing.seats_changed',
                targetType: 'workspace',
                targetId: input.workspaceId,
                metadata: seatChangeMetadata(members, { reason: input.reason })
              },
              write: () =>
                db
                  .update(workspaceSubscriptions)
                  .set({ seatQuantity: members, updatedAt })
                  .where(eq(workspaceSubscriptions.workspaceId, input.workspaceId))
            })
            return { outcome: 'synced', quantity: members }
          })
      }
    })
  )
}
