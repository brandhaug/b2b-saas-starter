import { Effect, Layer, Ref } from 'effect'

import { CapabilityUnavailable } from '../errors.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { type SeedRoster } from '../governance/workspace-membership.ts'
import { planById, PLANS } from './plan-catalog.ts'
import {
  Billing,
  nextSubscriptionState,
  planChangeMetadata,
  seatChangeMetadata,
  seatQuantityMoved,
  type SubscriptionState
} from './billing.ts'
/**
 * The in-memory billing adapter. `stripeConfigured` mirrors the env gate:
 * `false` makes `startCheckout` and `startPortalSession` fail exactly like
 * the Live layer does with unset vars, so tests exercise the degraded path
 * without a provider. Subscription state (customer, seat item, quantity) is
 * simulated in a `Ref` seeded from fixture rows, so seat sync and the portal
 * are demonstrable with no Stripe and no D1.
 */

/** One fixture subscription row, as the seed layer stores it. */
export type SeedSubscriptionFixture = {
  readonly workspaceId: string
  readonly customerId: string
  readonly subscriptionId?: string | null
  readonly subscriptionItemId?: string | null
  readonly seatQuantity: number
}

function toSeedSubscription(fixture: SeedSubscriptionFixture): SubscriptionState {
  return {
    customerId: fixture.customerId,
    subscriptionId: fixture.subscriptionId ?? null,
    subscriptionItemId: fixture.subscriptionItemId ?? null,
    seatQuantity: fixture.seatQuantity
  }
}

export function SeedBilling(options?: {
  readonly stripeConfigured?: boolean | undefined
  /** Fixture subscription rows: checkout-linked workspaces the demo tests. */
  readonly subscriptions?: ReadonlyArray<SeedSubscriptionFixture> | undefined
  /**
   * The same roster `SeedWorkspaceMembership` serves, so `syncSeats` counts
   * the members the seed app actually shows. Absent, the count is 0 — the
   * fixture of a workspace nobody joined.
   */
  readonly roster?: SeedRoster | undefined
}): Layer.Layer<Billing, never, AuditEventLog> {
  return Layer.effect(Billing)(
    Effect.gen(function* () {
      const audit = yield* AuditEventLog
      const configured = options?.stripeConfigured ?? false

      // Local mutation of the fixture workspace's planId, read back by
      // `currentPlan` — same read-your-write shape as Live.
      const planOverrides = yield* Ref.make<ReadonlyMap<string, string>>(new Map())
      // The simulated `workspace_subscriptions` table.
      const subscriptions = yield* Ref.make<ReadonlyMap<string, SubscriptionState>>(
        new Map(
          (options?.subscriptions ?? []).map((fixture) => [
            fixture.workspaceId,
            toSeedSubscription(fixture)
          ])
        )
      )

      let memberCount: Effect.Effect<number> = Effect.succeed(0)
      if (options?.roster !== undefined) {
        memberCount = Effect.map(Ref.get(options.roster), (members) => members.length)
      }

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
            let quantity = 1
            if (planById(input.planId).pricing === 'per_seat') {
              quantity = yield* memberCount
            }
            const url = `https://checkout.stripe.com/c/pay/test_${input.planId}`
            yield* audit.record({
              workspaceId: ctx.workspace.id,
              actorUserId: ctx.actor?.userId ?? null,
              eventType: 'billing.checkout_started',
              targetType: 'workspace',
              targetId: ctx.workspace.id,
              metadata: { planId: input.planId, quantity }
            })
            return { url }
          }),
        startPortalSession: (_input) =>
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
            const current = (yield* Ref.get(subscriptions)).get(ctx.workspace.id)
            if (current === undefined) {
              return yield* Effect.fail(
                new CapabilityUnavailable({
                  capability: 'billing',
                  reason: 'no_billing_profile'
                })
              )
            }
            yield* audit.record({
              workspaceId: ctx.workspace.id,
              actorUserId: ctx.actor?.userId ?? null,
              eventType: 'billing.portal_opened',
              targetType: 'workspace',
              targetId: ctx.workspace.id,
              metadata: {}
            })
            return {
              url: `https://billing.stripe.com/p/session/test_portal_${ctx.workspace.id}`
            }
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
          }),
        applySubscriptionEvent: (input) =>
          Effect.gen(function* () {
            const existing = (yield* Ref.get(subscriptions)).get(input.workspaceId)
            // The shared reduction (`billing.ts`) both adapters enforce:
            // `null` means the event carries no customer and no row holds one
            // — the Live adapter answers the same input `false`.
            const next = nextSubscriptionState(input, existing)
            if (next === null) {
              return false
            }
            yield* Ref.update(subscriptions, (map) => {
              const nextMap = new Map(map)
              nextMap.set(input.workspaceId, next)
              return nextMap
            })
            if (seatQuantityMoved(input, next, existing)) {
              yield* audit.record({
                workspaceId: input.workspaceId,
                actorUserId: null,
                eventType: 'billing.seats_changed',
                targetType: 'workspace',
                targetId: input.workspaceId,
                metadata: seatChangeMetadata(next.seatQuantity, input.detail)
              })
            }
            return true
          }),
        syncSeats: (input) =>
          Effect.gen(function* () {
            // Workspace state is checked before the provider gate, so a
            // workspace that never checked out answers `no_subscription`
            // whether or not Stripe is configured on this deployment.
            const members = yield* memberCount
            const current = (yield* Ref.get(subscriptions)).get(input.workspaceId)
            if (current === undefined) {
              return { outcome: 'no_subscription', quantity: null }
            }
            if (current.subscriptionItemId === null) {
              return { outcome: 'no_seat_item', quantity: null }
            }
            if (current.seatQuantity === members) {
              return { outcome: 'quantity_unchanged', quantity: members }
            }
            if (!configured) {
              return { outcome: 'provider_not_configured', quantity: null }
            }
            yield* Ref.update(subscriptions, (map) => {
              const next = new Map(map)
              next.set(input.workspaceId, { ...current, seatQuantity: members })
              return next
            })
            yield* audit.record({
              workspaceId: input.workspaceId,
              actorUserId: null,
              eventType: 'billing.seats_changed',
              targetType: 'workspace',
              targetId: input.workspaceId,
              metadata: seatChangeMetadata(members, { reason: input.reason })
            })
            return { outcome: 'synced', quantity: members }
          })
      }
    })
  )
}
