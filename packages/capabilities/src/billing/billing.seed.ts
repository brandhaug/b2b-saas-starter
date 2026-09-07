import { DateTime, Effect, Layer, Ref, Semaphore } from 'effect'

import { CapabilityUnavailable } from '../errors.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { type SeedRoster } from '../governance/workspace-membership.ts'
import { planById, PLANS } from './plan-catalog.ts'
import { resolveBillingState } from './billing-state.ts'
import {
  Billing,
  planChangeMetadata,
  seatChangeMetadata,
  type BillingSynchronizationStatus,
  type CheckoutInput,
  type ProcessProviderEventInput,
  type ProcessProviderEventResult,
  type ReconcileWorkspaceInput,
  type ReconcileResult,
  type SeatSyncResult,
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

/**
 * Authoritative provider state used by Seed reconciliation. Keeping this
 * separate from the stored subscription row lets fixture tests model dropped
 * webhook updates and provider-side cancellations without changing the local
 * projection first.
 */
export type SeedProviderSubscriptionFixture = SeedSubscriptionFixture & {
  readonly planId?: string | undefined
  readonly status?: string | undefined
}

type CheckoutClaim = {
  readonly planId: string
  readonly quantity: number
  readonly successUrl: string
  readonly cancelUrl: string
  readonly url: string
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
  /** Provider snapshots used by the reconciliation fixture. */
  readonly providerSubscriptions?:
    | ReadonlyArray<SeedProviderSubscriptionFixture>
    | undefined
  /** Initial plan projection for identity-keyed reconciliation calls. */
  readonly workspacePlans?: Readonly<Record<string, string>> | undefined
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
      const workspacePlans = options?.workspacePlans ?? {}

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
      const providerSubscriptions = yield* Ref.make<
        ReadonlyMap<string, SeedProviderSubscriptionFixture>
      >(
        new Map(
          (options?.providerSubscriptions ?? []).map((fixture) => [
            fixture.workspaceId,
            fixture
          ])
        )
      )
      const checkoutClaims = yield* Ref.make<ReadonlyMap<string, CheckoutClaim>>(
        new Map()
      )
      const synchronization = yield* Ref.make<
        ReadonlyMap<string, BillingSynchronizationStatus>
      >(new Map())
      const processedEvents = yield* Ref.make<ReadonlySet<string>>(new Set())

      let memberCount: Effect.Effect<number> = Effect.succeed(0)
      if (options?.roster !== undefined) {
        memberCount = Effect.map(Ref.get(options.roster), (members) => members.length)
      }

      const providerLock = yield* Semaphore.make(1)
      const withProviderLock = providerLock.withPermits(1)

      const reconcileWorkspaceUnsafe = Effect.fn('Billing.reconcileWorkspaceUnsafe')(
        function* (input: ReconcileWorkspaceInput) {
          const stored = (yield* Ref.get(subscriptions)).get(input.workspaceId)
          const provider = (yield* Ref.get(providerSubscriptions)).get(
            input.workspaceId
          )
          if (provider === undefined) {
            return {
              workspaceId: input.workspaceId,
              outcome: 'current',
              drift: []
            } satisfies ReconcileResult
          }
          if (!configured) {
            yield* Ref.update(synchronization, (map) => {
              const next = new Map(map)
              next.set(input.workspaceId, {
                status: 'delayed',
                lastSyncedAt: map.get(input.workspaceId)?.lastSyncedAt ?? null
              })
              return next
            })
            return {
              workspaceId: input.workspaceId,
              outcome: 'delayed',
              drift: ['provider_not_configured']
            } satisfies ReconcileResult
          }
          if (stored !== undefined && stored.customerId !== provider.customerId) {
            yield* Ref.update(synchronization, (map) => {
              const next = new Map(map)
              next.set(input.workspaceId, {
                status: 'conflict',
                lastSyncedAt: map.get(input.workspaceId)?.lastSyncedAt ?? null
              })
              return next
            })
            return {
              workspaceId: input.workspaceId,
              outcome: 'conflict',
              drift: ['customer_ownership_mismatch']
            } satisfies ReconcileResult
          }
          const now = DateTime.formatIso(yield* DateTime.now)
          const currentPlanId =
            (yield* Ref.get(planOverrides)).get(input.workspaceId) ??
            workspacePlans[input.workspaceId] ??
            'starter'
          const canceled =
            provider.status === 'canceled' || provider.status === 'incomplete_expired'
          let providerSnapshot: ReadonlyArray<{
            readonly id: string
            readonly customer: string
            readonly status: string
            readonly metadata: { readonly workspaceId: string }
            readonly items: {
              readonly data: ReadonlyArray<{
                readonly id: string
                readonly quantity: number
                readonly price: { readonly id: string }
              }>
            }
          }> = []
          if (!canceled) {
            providerSnapshot = [
              {
                id: provider.subscriptionId ?? `seed_${input.workspaceId}`,
                customer: provider.customerId,
                status: provider.status ?? 'active',
                metadata: { workspaceId: input.workspaceId },
                items: {
                  data: [
                    {
                      id: provider.subscriptionItemId ?? `item_${input.workspaceId}`,
                      quantity: provider.seatQuantity,
                      price: { id: provider.planId ?? '' }
                    }
                  ]
                }
              }
            ]
          }
          const decision = resolveBillingState({
            workspaceId: input.workspaceId,
            customerId: provider.customerId,
            subscriptions: providerSnapshot,
            hasMore: false,
            priceIds: Object.fromEntries(PLANS.map((plan) => [plan.id, plan.id])),
            currentPlanId
          })
          if (decision.kind === 'conflict') {
            yield* Ref.update(synchronization, (map) => {
              const next = new Map(map)
              next.set(input.workspaceId, {
                status: 'conflict',
                lastSyncedAt: map.get(input.workspaceId)?.lastSyncedAt ?? null
              })
              return next
            })
            return {
              workspaceId: input.workspaceId,
              outcome: 'conflict',
              drift: [decision.reason]
            } satisfies ReconcileResult
          }
          const providerPlan = planById(decision.planId)
          let desiredQuantity = decision.subscription.seatQuantity
          if (providerPlan.pricing === 'per_seat') {
            desiredQuantity = yield* memberCount
          }
          const planChanged = currentPlanId !== decision.planId
          const quantityChanged = stored?.seatQuantity !== desiredQuantity
          const providerQuantityChanged =
            providerPlan.pricing === 'per_seat' &&
            provider.seatQuantity !== desiredQuantity
          const linkageChanged =
            stored === undefined ||
            stored.subscriptionId !== decision.subscription.subscriptionId ||
            stored.subscriptionItemId !== decision.subscription.subscriptionItemId
          if (planChanged) {
            yield* audit.record({
              workspaceId: input.workspaceId,
              actorUserId: null,
              actorType: 'system',
              eventType: 'billing.plan_changed',
              targetType: 'workspace',
              targetId: input.workspaceId,
              metadata: planChangeMetadata(providerPlan.id, {
                reason: input.reason ?? 'scheduled_reconciliation'
              })
            })
          }
          if (quantityChanged || providerQuantityChanged) {
            yield* audit.record({
              workspaceId: input.workspaceId,
              actorUserId: null,
              actorType: 'system',
              eventType: 'billing.seats_changed',
              targetType: 'workspace',
              targetId: input.workspaceId,
              metadata: seatChangeMetadata(desiredQuantity, {
                reason: input.reason ?? 'scheduled_reconciliation'
              })
            })
          }
          const next: SubscriptionState = {
            ...decision.subscription,
            seatQuantity: desiredQuantity
          }
          yield* Ref.update(subscriptions, (map) => {
            const updated = new Map(map)
            updated.set(input.workspaceId, next)
            return updated
          })
          yield* Ref.update(providerSubscriptions, (map) => {
            const updated = new Map(map)
            updated.set(input.workspaceId, {
              ...provider,
              seatQuantity: desiredQuantity
            })
            return updated
          })
          yield* Ref.update(planOverrides, (map) => {
            const updated = new Map(map)
            updated.set(input.workspaceId, providerPlan.id)
            return updated
          })
          let reconciliationStatus: BillingSynchronizationStatus['status'] = 'pending'
          let reconciliationSyncedAt =
            (yield* Ref.get(synchronization)).get(input.workspaceId)?.lastSyncedAt ??
            null
          if (decision.verified) {
            reconciliationStatus = 'current'
            reconciliationSyncedAt = now
          }
          yield* Ref.update(synchronization, (map) => {
            const updated = new Map(map)
            updated.set(input.workspaceId, {
              status: reconciliationStatus,
              lastSyncedAt: reconciliationSyncedAt
            })
            return updated
          })
          const drift: Array<string> = []
          if (planChanged) {
            drift.push('plan')
          }
          if (quantityChanged || providerQuantityChanged) {
            drift.push('seat_quantity')
          }
          if (linkageChanged) {
            drift.push('subscription')
          }
          let outcome: ReconcileResult['outcome'] = 'current'
          if (drift.length > 0) {
            outcome = 'repaired'
          }
          return {
            workspaceId: input.workspaceId,
            outcome,
            drift
          } satisfies ReconcileResult
        }
      )

      const reconcileWorkspace = Effect.fn('Billing.reconcileWorkspace')(function* (
        input: ReconcileWorkspaceInput
      ) {
        return yield* withProviderLock(
          Effect.uninterruptible(reconcileWorkspaceUnsafe(input))
        )
      })

      const capability = {
        configured: Effect.fn('Billing.configured')(() => Effect.succeed(configured))(),
        currentPlan: Effect.fn('Billing.currentPlan')(function* () {
          const ctx = yield* WorkspaceContext
          const overrides = yield* Ref.get(planOverrides)
          return planById(
            overrides.get(ctx.workspace.id) ??
              workspacePlans[ctx.workspace.id] ??
              ctx.workspace.planId
          )
        })(),
        synchronizationStatus: Effect.fn('Billing.synchronizationStatus')(function* () {
          const ctx = yield* WorkspaceContext
          if (!(yield* Ref.get(subscriptions)).has(ctx.workspace.id) && !configured) {
            return {
              status: 'current',
              lastSyncedAt: null
            } satisfies BillingSynchronizationStatus
          }
          const recorded = (yield* Ref.get(synchronization)).get(ctx.workspace.id)
          if (recorded !== undefined) {
            return recorded
          }
          let status: BillingSynchronizationStatus['status'] = 'current'
          if (configured) {
            status = 'pending'
          }
          return {
            status,
            lastSyncedAt: null
          } satisfies BillingSynchronizationStatus
        })(),
        processProviderEvent: Effect.fn('Billing.processProviderEvent')(function* (
          input: ProcessProviderEventInput
        ) {
          return yield* withProviderLock(
            Effect.gen(function* () {
              if ((yield* Ref.get(processedEvents)).has(input.providerEventId)) {
                return {
                  outcome: 'duplicate',
                  providerEventId: input.providerEventId
                } satisfies ProcessProviderEventResult
              }
              const workspaceId = input.workspaceId
              if (workspaceId === undefined) {
                return {
                  outcome: 'conflict',
                  providerEventId: input.providerEventId,
                  reason: 'missing_workspace'
                } satisfies ProcessProviderEventResult
              }
              if (!configured) {
                yield* Ref.update(synchronization, (map) => {
                  const next = new Map(map)
                  next.set(workspaceId, {
                    status: 'delayed',
                    lastSyncedAt: map.get(workspaceId)?.lastSyncedAt ?? null
                  })
                  return next
                })
                return yield* Effect.fail(
                  new CapabilityUnavailable({
                    capability: 'billing',
                    reason: 'provider_not_configured'
                  })
                )
              }
              const provider = (yield* Ref.get(providerSubscriptions)).get(workspaceId)
              if (provider === undefined) {
                yield* Ref.update(synchronization, (map) => {
                  const next = new Map(map)
                  next.set(workspaceId, {
                    status: 'conflict',
                    lastSyncedAt: map.get(workspaceId)?.lastSyncedAt ?? null
                  })
                  return next
                })
                return {
                  outcome: 'conflict',
                  providerEventId: input.providerEventId,
                  reason: 'provider_snapshot_missing'
                } satisfies ProcessProviderEventResult
              }
              const reconciled = yield* Effect.uninterruptible(
                reconcileWorkspaceUnsafe({ workspaceId })
              )
              if (reconciled.outcome === 'conflict') {
                return {
                  outcome: 'conflict',
                  providerEventId: input.providerEventId,
                  reason: reconciled.drift[0] ?? 'provider_conflict'
                } satisfies ProcessProviderEventResult
              }
              if (reconciled.outcome === 'delayed') {
                return {
                  outcome: 'conflict',
                  providerEventId: input.providerEventId,
                  reason: 'provider_unavailable'
                } satisfies ProcessProviderEventResult
              }
              yield* Ref.update(processedEvents, (events) => {
                const next = new Set(events)
                next.add(input.providerEventId)
                return next
              })
              return {
                outcome: 'applied',
                providerEventId: input.providerEventId
              } satisfies ProcessProviderEventResult
            })
          )
        }),
        reconcileWorkspace,
        reconcileBatch: Effect.fn('Billing.reconcileBatch')(function* (input?: {
          readonly limit?: number | undefined
        }) {
          const ids = [
            ...new Set([
              ...(yield* Ref.get(subscriptions)).keys(),
              ...(yield* Ref.get(providerSubscriptions)).keys()
            ])
          ].slice(0, input?.limit ?? 25)
          return yield* Effect.forEach(ids, (workspaceId) =>
            reconcileWorkspace({ workspaceId })
          )
        }),
        startCheckout: Effect.fn('Billing.startCheckout')(function* (
          input: CheckoutInput
        ) {
          return yield* withProviderLock(
            Effect.uninterruptible(
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
                const existingSubscription = (yield* Ref.get(subscriptions)).get(
                  ctx.workspace.id
                )
                const provider = (yield* Ref.get(providerSubscriptions)).get(
                  ctx.workspace.id
                )
                if (
                  existingSubscription?.subscriptionId !== null &&
                  existingSubscription !== undefined &&
                  provider !== undefined &&
                  provider.status !== 'canceled' &&
                  provider.status !== 'incomplete_expired'
                ) {
                  yield* audit.record({
                    workspaceId: ctx.workspace.id,
                    actorUserId: ctx.actor?.userId ?? null,
                    actorType: ctx.actorType,
                    eventType: 'billing.portal_opened',
                    targetType: 'workspace',
                    targetId: ctx.workspace.id,
                    metadata: {}
                  })
                  return {
                    url: `https://billing.stripe.com/p/session/test_portal_${ctx.workspace.id}`
                  }
                }
                const existing = (yield* Ref.get(checkoutClaims)).get(ctx.workspace.id)
                if (existing !== undefined) {
                  if (existing.planId !== input.planId) {
                    return yield* Effect.fail(
                      new CapabilityUnavailable({
                        capability: 'billing',
                        reason: 'checkout_in_progress'
                      })
                    )
                  }
                  return { url: existing.url }
                }
                let quantity = 1
                if (planById(input.planId).pricing === 'per_seat') {
                  quantity = yield* memberCount
                }
                const claim: CheckoutClaim = {
                  planId: input.planId,
                  quantity,
                  successUrl: input.successUrl,
                  cancelUrl: input.cancelUrl,
                  url: `https://checkout.stripe.com/c/pay/test_${ctx.workspace.id}_${input.planId}`
                }
                // Record evidence before publishing the in-memory claim. A
                // failed audit leaves no claim that could return an unverified URL.
                yield* audit.record({
                  workspaceId: ctx.workspace.id,
                  actorUserId: ctx.actor?.userId ?? null,
                  actorType: ctx.actorType,
                  eventType: 'billing.checkout_started',
                  targetType: 'workspace',
                  targetId: ctx.workspace.id,
                  metadata: { planId: claim.planId, quantity: claim.quantity }
                })
                yield* Ref.update(checkoutClaims, (claims) => {
                  const next = new Map(claims)
                  next.set(ctx.workspace.id, claim)
                  return next
                })
                return { url: claim.url }
              })
            )
          )
        }),
        startPortalSession: Effect.fn('Billing.startPortalSession')(function* (_input: {
          readonly returnUrl: string
        }) {
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
            actorType: ctx.actorType,
            eventType: 'billing.portal_opened',
            targetType: 'workspace',
            targetId: ctx.workspace.id,
            metadata: {}
          })
          return {
            url: `https://billing.stripe.com/p/session/test_portal_${ctx.workspace.id}`
          }
        }),
        syncSeats: Effect.fn('Billing.syncSeats')(function* (input: {
          readonly workspaceId: string
          readonly reason: string
        }) {
          return yield* withProviderLock(
            Effect.uninterruptible(
              Effect.gen(function* () {
                // Workspace state is checked before the provider gate, so a
                // workspace that never checked out answers `no_subscription`
                // whether or not Stripe is configured on this deployment.
                const members = yield* memberCount
                const current = (yield* Ref.get(subscriptions)).get(input.workspaceId)
                if (current === undefined) {
                  return {
                    outcome: 'no_subscription',
                    quantity: null
                  } satisfies SeatSyncResult
                }
                const provider = (yield* Ref.get(providerSubscriptions)).get(
                  input.workspaceId
                )
                if (configured && provider !== undefined) {
                  const reconciled = yield* reconcileWorkspaceUnsafe(input)
                  if (reconciled.outcome === 'conflict') {
                    return yield* Effect.fail(
                      new CapabilityUnavailable({
                        capability: 'billing',
                        reason: reconciled.drift[0] ?? 'billing_conflict'
                      })
                    )
                  }
                  const updated = (yield* Ref.get(subscriptions)).get(input.workspaceId)
                  if (updated?.subscriptionItemId === null || updated === undefined) {
                    return {
                      outcome: 'no_seat_item',
                      quantity: null
                    } satisfies SeatSyncResult
                  }
                  if (reconciled.drift.includes('seat_quantity')) {
                    return {
                      outcome: 'synced',
                      quantity: updated.seatQuantity
                    } satisfies SeatSyncResult
                  }
                  return {
                    outcome: 'quantity_unchanged',
                    quantity: updated.seatQuantity
                  } satisfies SeatSyncResult
                }
                if (current.subscriptionItemId === null) {
                  return {
                    outcome: 'no_seat_item',
                    quantity: null
                  } satisfies SeatSyncResult
                }
                if (current.seatQuantity === members) {
                  return {
                    outcome: 'quantity_unchanged',
                    quantity: members
                  } satisfies SeatSyncResult
                }
                if (!configured) {
                  yield* Ref.update(synchronization, (map) => {
                    const nextMap = new Map(map)
                    nextMap.set(input.workspaceId, {
                      status: 'delayed',
                      lastSyncedAt: map.get(input.workspaceId)?.lastSyncedAt ?? null
                    })
                    return nextMap
                  })
                  return {
                    outcome: 'provider_not_configured',
                    quantity: null
                  } satisfies SeatSyncResult
                }
                const syncedAt = DateTime.formatIso(yield* DateTime.now)
                yield* audit.record({
                  workspaceId: input.workspaceId,
                  actorUserId: null,
                  actorType: 'system',
                  eventType: 'billing.seats_changed',
                  targetType: 'workspace',
                  targetId: input.workspaceId,
                  metadata: seatChangeMetadata(members, { reason: input.reason })
                })
                yield* Ref.update(subscriptions, (map) => {
                  const next = new Map(map)
                  next.set(input.workspaceId, { ...current, seatQuantity: members })
                  return next
                })
                yield* Ref.update(synchronization, (map) => {
                  const nextMap = new Map(map)
                  nextMap.set(input.workspaceId, {
                    status: 'current',
                    lastSyncedAt: syncedAt
                  })
                  return nextMap
                })
                return { outcome: 'synced', quantity: members } satisfies SeatSyncResult
              })
            )
          )
        })
      }
      return capability
    })
  )
}
