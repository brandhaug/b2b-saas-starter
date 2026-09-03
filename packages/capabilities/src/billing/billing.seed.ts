import { Effect, Layer, Ref } from 'effect'

import { CapabilityUnavailable } from '../errors.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { type SeedRoster } from '../governance/workspace-membership.ts'
import { planById, PLANS } from './plan-catalog.ts'
import {
  Billing,
  planChangeMetadata,
  seatChangeMetadata,
  type ApplySubscriptionEventInput
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

type SeedSubscription = {
  readonly customerId: string
  readonly subscriptionId: string | null
  readonly subscriptionItemId: string | null
  readonly seatQuantity: number
}

function toSeedSubscription(fixture: SeedSubscriptionFixture): SeedSubscription {
  return {
    customerId: fixture.customerId,
    subscriptionId: fixture.subscriptionId ?? null,
    subscriptionItemId: fixture.subscriptionItemId ?? null,
    seatQuantity: fixture.seatQuantity
  }
}

/** The quantity an event leaves behind: 0 on deletion, else its own or the stored one. */
function nextQuantity(
  input: ApplySubscriptionEventInput,
  existing: SeedSubscription | undefined
): number {
  if (input.deleted === true) {
    return 0
  }
  return input.quantity ?? existing?.seatQuantity ?? 0
}

/**
 * Whether the event changes the stored quantity at all — the seed mirror of
 * the Live adapter's "audit only when the number moved" rule, so both
 * adapters record `billing.seats_changed` for exactly the same events.
 */
function quantityChanged(
  input: ApplySubscriptionEventInput,
  existing: SeedSubscription | undefined
): boolean {
  return (
    (input.quantity !== undefined || input.deleted === true) &&
    (existing?.seatQuantity ?? 0) !== nextQuantity(input, existing)
  )
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
      const subscriptions = yield* Ref.make<ReadonlyMap<string, SeedSubscription>>(
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
            const customerId = input.customerId ?? existing?.customerId
            // Nothing to record: the event carries no customer and no row
            // holds one — the Live adapter answers the same input `false`.
            if (customerId === undefined) {
              return false
            }
            const deleted = input.deleted === true
            let subscriptionId: string | null = null
            let subscriptionItemId: string | null = null
            if (!deleted) {
              subscriptionId = input.subscriptionId ?? existing?.subscriptionId ?? null
              subscriptionItemId =
                input.subscriptionItemId ?? existing?.subscriptionItemId ?? null
            }
            yield* Ref.update(subscriptions, (map) => {
              const next = new Map(map)
              next.set(input.workspaceId, {
                customerId,
                subscriptionId,
                subscriptionItemId,
                seatQuantity: nextQuantity(input, existing)
              })
              return next
            })
            if (quantityChanged(input, existing)) {
              yield* audit.record({
                workspaceId: input.workspaceId,
                actorUserId: null,
                eventType: 'billing.seats_changed',
                targetType: 'workspace',
                targetId: input.workspaceId,
                metadata: seatChangeMetadata(
                  nextQuantity(input, existing),
                  input.detail
                )
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
