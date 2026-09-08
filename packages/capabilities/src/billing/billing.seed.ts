import { NotificationFeed } from '../notifications/notification-feed.ts'
import { lifecycleNotices } from './billing-notices.ts'
import { DateTime, Effect, Layer, Ref, Semaphore } from 'effect'

import { type StripeSubscriptionResponse } from './stripe.ts'
import { CapabilityUnavailable } from '../errors.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { type Member } from '../governance/workspace-identity.ts'
import { type SeedRoster } from '../governance/workspace-membership.ts'
import { planById, PLANS } from './plan-catalog.ts'
import {
  effectivePlanDecision,
  emptySubscription,
  resolveBillingState,
  type PaymentEvidence
} from './billing-state.ts'
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
  type SubscriptionStatus,
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
  readonly subscribedPlanId?: string | undefined
  readonly lastPaymentAt?: string | null | undefined
  readonly paymentVerified?: boolean | undefined
  readonly currentPeriodStart?: string | null | undefined
  readonly status?: SubscriptionStatus | undefined
  readonly priceId?: string | null | undefined
  readonly currentPeriodEnd?: string | null | undefined
  readonly trialEnd?: string | null | undefined
  readonly firstFailedAt?: string | null | undefined
  readonly graceEndsAt?: string | null | undefined
  readonly cancelAtPeriodEnd?: boolean | undefined
}

/**
 * Authoritative provider state used by Seed reconciliation. Keeping this
 * separate from the stored subscription row lets fixture tests model dropped
 * webhook updates and provider-side cancellations without changing the local
 * projection first.
 */
export type SeedProviderSubscriptionFixture = SeedSubscriptionFixture & {
  readonly planId?: string | undefined
  readonly payment?: PaymentEvidence | undefined
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
    ...emptySubscription(fixture.customerId),
    subscriptionId: fixture.subscriptionId ?? null,
    subscriptionItemId: fixture.subscriptionItemId ?? null,
    seatQuantity: fixture.seatQuantity,
    status: fixture.status ?? 'active',
    subscribedPlanId: fixture.subscribedPlanId ?? 'team',
    priceId: fixture.priceId ?? null,
    currentPeriodStart: fixture.currentPeriodStart ?? null,
    currentPeriodEnd: fixture.currentPeriodEnd ?? null,
    trialEnd: fixture.trialEnd ?? null,
    firstFailedAt: fixture.firstFailedAt ?? null,
    graceEndsAt: fixture.graceEndsAt ?? null,
    lastPaymentAt: fixture.lastPaymentAt ?? null,
    cancelAtPeriodEnd: fixture.cancelAtPeriodEnd ?? false,
    paymentVerified: fixture.paymentVerified ?? false
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
  readonly providerState?:
    | Ref.Ref<ReadonlyMap<string, SeedProviderSubscriptionFixture>>
    | undefined
  /** Initial plan projection for identity-keyed reconciliation calls. */
  readonly workspacePlans?: Readonly<Record<string, string>> | undefined
  /**
   * The same roster `SeedWorkspaceMembership` serves, so `syncSeats` counts
   * the members the seed app actually shows. Absent, the count is 0 — the
   * fixture of a workspace nobody joined.
   */
  readonly roster?: SeedRoster | undefined
}): Layer.Layer<Billing, never, AuditEventLog | NotificationFeed> {
  return Layer.effect(Billing)(
    Effect.gen(function* () {
      const audit = yield* AuditEventLog
      const feed = yield* NotificationFeed
      const sentNotices = yield* Ref.make<ReadonlySet<string>>(new Set())
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
      const providerSubscriptions =
        options?.providerState ??
        (yield* Ref.make<ReadonlyMap<string, SeedProviderSubscriptionFixture>>(
          new Map(
            (options?.providerSubscriptions ?? []).map((fixture) => [
              fixture.workspaceId,
              fixture
            ])
          )
        ))
      const checkoutClaims = yield* Ref.make<ReadonlyMap<string, CheckoutClaim>>(
        new Map()
      )
      const synchronization = yield* Ref.make<
        ReadonlyMap<string, BillingSynchronizationStatus>
      >(new Map())
      const processedEvents = yield* Ref.make<ReadonlySet<string>>(new Set())
      const pendingEvents = yield* Ref.make<
        ReadonlyMap<string, ProcessProviderEventInput>
      >(new Map())

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
          let trialEnd: number | null = null
          if (provider.trialEnd !== null && provider.trialEnd !== undefined) {
            trialEnd = Date.parse(provider.trialEnd) / 1000
          }
          let providerSnapshot: ReadonlyArray<StripeSubscriptionResponse> = []
          if (
            provider.status !== 'canceled' &&
            provider.status !== 'incomplete_expired'
          ) {
            providerSnapshot = [
              {
                id: provider.subscriptionId ?? `seed_${input.workspaceId}`,
                customer: provider.customerId,
                status: provider.status ?? 'active',
                metadata: { workspaceId: input.workspaceId },
                cancel_at_period_end: provider.cancelAtPeriodEnd ?? false,
                trial_end: trialEnd,
                latest_invoice: null,
                items: {
                  data: [
                    {
                      id: provider.subscriptionItemId ?? `item_${input.workspaceId}`,
                      quantity: provider.seatQuantity,
                      current_period_start:
                        Date.parse(provider.currentPeriodStart ?? now) / 1000,
                      current_period_end:
                        Date.parse(provider.currentPeriodEnd ?? now) / 1000,
                      price: {
                        id: provider.planId ?? '',
                        active: true,
                        currency: 'usd',
                        unit_amount: 1200,
                        billing_scheme: 'per_unit',
                        transform_quantity: null,
                        recurring: {
                          interval: 'month',
                          interval_count: 1,
                          usage_type: 'licensed'
                        }
                      }
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
            previous: stored ?? null,
            now,
            payment: provider.payment ?? {
              lastPaymentAt: null,
              firstFailedAt: null,
              currentInvoicePaid: false
            }
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
          if (decision.subscription.subscriptionItemId !== null) {
            desiredQuantity = yield* memberCount
          }
          const planChanged = currentPlanId !== decision.planId
          const quantityChanged = stored?.seatQuantity !== desiredQuantity
          const providerQuantityChanged =
            decision.subscription.subscriptionItemId !== null &&
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
          for (const notice of lifecycleNotices(stored ?? null, next, now)) {
            const key = `${input.workspaceId}:${notice.key}`
            if ((yield* Ref.get(sentNotices)).has(key)) {
              continue
            }
            let recipients: ReadonlyArray<Member> = []
            if (options?.roster !== undefined) {
              recipients = yield* Ref.get(options.roster)
            }
            for (const member of recipients.filter(
              (recipient) => recipient.role === 'owner' || recipient.role === 'admin'
            )) {
              yield* feed.create({
                workspaceId: input.workspaceId,
                userId: member.id,
                deduplicationKey: key,
                kind: 'billing.plan_changed',
                title: notice.title,
                message: notice.message
              })
            }
            yield* audit.record({
              workspaceId: input.workspaceId,
              actorUserId: null,
              actorType: 'system',
              eventType: `billing.${notice.type}`,
              targetType: 'workspace',
              targetId: input.workspaceId,
              metadata: { noticeId: key, graceEndsAt: next.graceEndsAt }
            })
            yield* Ref.update(sentNotices, (sent) => new Set([...sent, key]))
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

      const currentPlanForWorkspace = Effect.fn('Billing.currentPlanForWorkspace')(
        function* (workspaceId: string) {
          const current =
            (yield* Ref.get(planOverrides)).get(workspaceId) ??
            workspacePlans[workspaceId] ??
            'starter'
          const subscription = (yield* Ref.get(subscriptions)).get(workspaceId)
          if (subscription === undefined) {
            return planById(current)
          }
          return planById(
            effectivePlanDecision(subscription, DateTime.formatIso(yield* DateTime.now))
              .planId
          )
        }
      )
      const processProviderEvent = Effect.fn('Billing.processProviderEvent')(function* (
        input: ProcessProviderEventInput
      ) {
        return yield* withProviderLock(
          Effect.gen(function* () {
            if ((yield* Ref.get(processedEvents)).has(input.providerEventId)) {
              yield* Ref.update(pendingEvents, (events) => {
                const next = new Map(events)
                next.delete(input.providerEventId)
                return next
              })
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
            yield* Ref.update(pendingEvents, (events) => {
              const next = new Map(events)
              next.delete(input.providerEventId)
              return next
            })
            return {
              outcome: 'applied',
              providerEventId: input.providerEventId
            } satisfies ProcessProviderEventResult
          })
        )
      })

      const capability = {
        configured: Effect.succeed(configured),
        currentPlanForWorkspace,
        currentPlan: Effect.fn('Billing.currentPlan')(function* () {
          const ctx = yield* WorkspaceContext
          return yield* currentPlanForWorkspace(ctx.workspace.id)
        })(),
        lifecycleStatus: Effect.fn('Billing.lifecycleStatus')(function* () {
          const row = (yield* Ref.get(subscriptions)).get(
            (yield* WorkspaceContext).workspace.id
          )
          return {
            status: row?.status ?? 'canceled',
            planId: row?.subscribedPlanId ?? 'starter',
            currentPeriodEnd: row?.currentPeriodEnd ?? null,
            cancelAtPeriodEnd: row?.cancelAtPeriodEnd ?? false,
            trialEnd: row?.trialEnd ?? null,
            graceEndsAt: row?.graceEndsAt ?? null
          }
        })(),
        displayedPlans: Effect.forEach(PLANS, (plan) =>
          Effect.succeed({ ...plan, providerPrice: plan.price })
        ),
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
        processProviderEvent,
        recordProviderEvent: (input: ProcessProviderEventInput) =>
          Effect.gen(function* () {
            if ((yield* Ref.get(processedEvents)).has(input.providerEventId)) {
              return
            }
            yield* Ref.update(pendingEvents, (events) => {
              const next = new Map(events)
              next.set(input.providerEventId, input)
              return next
            })
          }),
        reconcileWorkspace,
        reconcileBatch: Effect.fn('Billing.reconcileBatch')(function* (input?: {
          readonly limit?: number | undefined
        }) {
          const limit = Math.max(1, Math.min(25, Math.floor(input?.limit ?? 25)))
          const pending = [...(yield* Ref.get(pendingEvents)).values()].slice(0, limit)
          yield* Effect.forEach(
            pending,
            (event) =>
              processProviderEvent(event).pipe(
                Effect.catchTag('CapabilityUnavailable', () => Effect.void)
              ),
            { concurrency: 3, discard: true }
          )
          const ids = [
            ...new Set([
              ...(yield* Ref.get(subscriptions)).keys(),
              ...(yield* Ref.get(providerSubscriptions)).keys()
            ])
          ].slice(0, Math.max(0, limit - pending.length))
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
                if (
                  planById(input.planId).purchase !== 'self_serve' ||
                  planById(input.planId).id !== input.planId
                ) {
                  return yield* Effect.fail(
                    new CapabilityUnavailable({
                      capability: 'billing',
                      reason: 'plan_not_self_serve'
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
      return Billing.of(capability)
    })
  )
}
