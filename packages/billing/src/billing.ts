import { billingLifecycleStatuses } from '@b2b-saas-starter/db/enums'
import { type JsonObject } from '@b2b-saas-starter/db/schema'
import { Context, DateTime, Effect, Schema, type Effect as EffectType } from 'effect'

import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { type WorkspaceContext } from './ports.ts'
import { type Plan } from './plan-catalog.ts'

/** Maps billing storage failures to a stable public reason. */
export function billingStoreUnavailable<A, E, R>(
  effect: EffectType.Effect<A, E, R>
): EffectType.Effect<A, CapabilityUnavailable, R> {
  return effect.pipe(
    Effect.mapError(
      () =>
        new CapabilityUnavailable({
          capability: 'billing',
          reason: 'billing_store_unavailable'
        })
    )
  )
}

/**
 * The Billing capability: the workspace's plan, the checkout handoff, the
 * Billing Portal handoff, and the provider-reported subscription state. The
 * plan catalog and its entitlement gate live in
 * [`plan-catalog.ts`](./plan-catalog.ts); the Stripe REST client, event
 * policies, and signature verifier live in [`stripe.ts`](./stripe.ts); the
 * seed adapter in [`billing.seed.ts`](./billing.seed.ts) and the D1-backed
 * adapter in [`billing.live.ts`](./billing.live.ts).
 */

/** The audit metadata for a plan change: the plan plus any provider detail. */
export function planChangeMetadata(planId: string, detail?: JsonObject): JsonObject {
  return { planId, ...detail }
}

/** The audit metadata for a seat change: the quantity plus any detail. */
export function seatChangeMetadata(quantity: number, detail?: JsonObject): JsonObject {
  return { quantity, ...detail }
}

/** The checkout handoff: where Stripe should send the browser afterwards. */
export type CheckoutInput = {
  readonly planId: string
  readonly successUrl: string
  readonly cancelUrl: string
}

/** The verified synchronization state shown to workspace operators. */
export type BillingSynchronizationStatus = {
  readonly status: 'current' | 'pending' | 'delayed' | 'conflict'
  readonly lastSyncedAt: string | null
}

/** A verified provider event handed to the fenced billing workflow. */
export type ProcessProviderEventInput = {
  readonly providerEventId: string
  readonly eventType: string
  readonly providerCreatedAt?: string | undefined
  readonly workspaceId?: string | undefined
  readonly planId?: string | undefined
  /** Event fields are routing hints only; Live re-reads Stripe authority. */
  readonly subscription?:
    | (ProviderSubscriptionHint & {
        readonly workspaceId?: string | undefined
      })
    | undefined
  readonly detail?: JsonObject | undefined
}

/** Provider fields used to resolve an inbound event to one workspace. */
export type ProviderSubscriptionHint = {
  readonly customerId?: string | undefined
  readonly subscriptionId?: string | undefined
  readonly subscriptionItemId?: string | undefined
  readonly quantity?: number | undefined
  readonly deleted?: boolean | undefined
  readonly detail?: JsonObject | undefined
}

export type ProcessProviderEventResult =
  | { readonly outcome: 'applied'; readonly providerEventId: string }
  | { readonly outcome: 'duplicate'; readonly providerEventId: string }
  | {
      readonly outcome: 'conflict'
      readonly providerEventId: string
      readonly reason: string
    }

export type ReconcileWorkspaceInput = {
  readonly workspaceId: string
  /** The queue or operator reason that caused this reconciliation, if known. */
  readonly reason?: string | undefined
  /** Positive provider evidence supplied by an authenticated operator retry. */
  readonly recovery?: {
    readonly customerId?: string | undefined
    readonly checkoutSessionId?: string | undefined
  }
}

export type ReconcileResult = {
  readonly workspaceId: string
  readonly outcome: 'current' | 'repaired' | 'delayed' | 'conflict'
  readonly drift: ReadonlyArray<string>
}

/** A Stripe-hosted handoff: checkout or the Billing Portal, same shape. */
type HostedSession = {
  /** The Stripe-hosted URL to redirect the browser to. */
  readonly url: string
}

/**
 * The return of `syncSeats`: what the member-count → subscription-quantity
 * sync actually did, so the background consumer can annotate its wide event
 * without re-deriving the decision. Every non-`synced` outcome is an honest
 * no-op, not a failure — the queue message is acked.
 */
type SeatSyncOutcome =
  | 'synced'
  /** The workspace has never checked out: no subscription row to sync. */
  | 'no_subscription'
  /** The subscription's seat item id is not known yet (link event not arrived). */
  | 'no_seat_item'
  /** The stored quantity already matches the member count. */
  | 'quantity_unchanged'
  /** Stripe env is unset on this deployment: nothing to reach. */
  | 'provider_not_configured'

export type SeatSyncResult = {
  readonly outcome: SeatSyncOutcome
  /** The quantity now stored, when the sync reached a stored row. */
  readonly quantity: number | null
}

/**
 * The subscription state one provider event leaves on the stored
 * `workspace_subscriptions` row: the customer the Billing Portal opens for,
 * the subscription and seat item ids, and the seat quantity. Provider events
 * are reconciled from authoritative provider state before this projection is
 * committed.
 */
export const SubscriptionStatus = Schema.Literals(billingLifecycleStatuses)
export type SubscriptionStatus = typeof SubscriptionStatus.Type

const BillingTimestamp = Schema.String.check(
  Schema.makeFilter(
    (value) => {
      const time = Date.parse(value)
      return (
        Number.isFinite(time) && DateTime.formatIso(DateTime.makeUnsafe(time)) === value
      )
    },
    {
      message: 'Expected a valid billing timestamp'
    }
  )
)

export const SubscriptionState = Schema.Struct({
  customerId: Schema.String,
  subscriptionId: Schema.NullOr(Schema.String),
  subscriptionItemId: Schema.NullOr(Schema.String),
  seatQuantity: Schema.Int,
  status: SubscriptionStatus,
  subscribedPlanId: Schema.String,
  priceId: Schema.NullOr(Schema.String),
  currentPeriodStart: Schema.NullOr(BillingTimestamp),
  currentPeriodEnd: Schema.NullOr(BillingTimestamp),
  cancelAtPeriodEnd: Schema.Boolean,
  trialEnd: Schema.NullOr(BillingTimestamp),
  firstFailedAt: Schema.NullOr(BillingTimestamp),
  graceEndsAt: Schema.NullOr(BillingTimestamp),
  lastPaymentAt: Schema.NullOr(BillingTimestamp),
  paymentVerified: Schema.Boolean
})
export type SubscriptionState = Schema.Schema.Type<typeof SubscriptionState>

export const BillingLifecycle = Schema.Struct({
  status: SubscriptionStatus,
  planId: Schema.String,
  currentPeriodEnd: Schema.NullOr(BillingTimestamp),
  cancelAtPeriodEnd: Schema.Boolean,
  trialEnd: Schema.NullOr(BillingTimestamp),
  graceEndsAt: Schema.NullOr(BillingTimestamp)
})
export type BillingLifecycle = Schema.Schema.Type<typeof BillingLifecycle>

export type DisplayedPlan = Plan & { readonly providerPrice: Plan['price'] }

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
  /** Identity-keyed plan read for credential and background execution gates. */
  readonly currentPlanForWorkspace: (
    workspaceId: string
  ) => Effect.Effect<Plan, CapabilityUnavailable>
  readonly lifecycleStatus: Effect.Effect<
    BillingLifecycle,
    CapabilityUnavailable,
    WorkspaceContext
  >
  readonly displayedPlans: Effect.Effect<
    ReadonlyArray<DisplayedPlan>,
    CapabilityUnavailable
  >
  /**
   * The last durable synchronization evidence for this workspace. This never
   * claims an upgrade from an unverified provider response.
   */
  readonly synchronizationStatus: Effect.Effect<
    BillingSynchronizationStatus,
    CapabilityUnavailable,
    WorkspaceContext
  >
  /** Applies one provider event with durable evidence and a fenced batch. */
  readonly processProviderEvent: (
    input: ProcessProviderEventInput
  ) => Effect.Effect<ProcessProviderEventResult, CapabilityUnavailable>
  /** Persists verified provider evidence before asynchronous processing. */
  readonly recordProviderEvent: (
    input: ProcessProviderEventInput
  ) => Effect.Effect<void, CapabilityUnavailable>
  /** Reconciles one workspace from an authoritative provider snapshot. */
  readonly reconcileWorkspace: (
    input: ReconcileWorkspaceInput
  ) => Effect.Effect<ReconcileResult, CapabilityUnavailable>
  /** Bounded reconciliation entry point; the worker supplies selected workspaces. */
  readonly reconcileBatch: (input?: {
    readonly limit?: number | undefined
  }) => Effect.Effect<ReadonlyArray<ReconcileResult>, CapabilityUnavailable>
  /**
   * Starts a Stripe Checkout session for one catalog plan and returns the
   * hosted URL. Fails `CapabilityUnavailable` (`provider_not_configured`) when
   * the Stripe env is unset — the honest degraded posture, not an exception —
   * and records a `billing.checkout_started` audit event on success. On a
   * per-seat plan the session's item quantity opens at the workspace's member
   * count; later changes ride `syncSeats`.
   */
  readonly startCheckout: (
    input: CheckoutInput
  ) => Effect.Effect<HostedSession, CapabilityUnavailable, WorkspaceContext>
  /**
   * Opens a Stripe Billing Portal session for the workspace's customer and
   * returns the hosted URL — invoices, payment method, and cancellation are
   * managed there, not here. Fails `CapabilityUnavailable`
   * (`provider_not_configured`) when the Stripe env is unset and
   * (`no_billing_profile`) when the workspace has never checked out, and
   * records a `billing.portal_opened` audit event on success.
   */
  readonly startPortalSession: (input: {
    readonly returnUrl: string
  }) => Effect.Effect<HostedSession, CapabilityUnavailable, WorkspaceContext>
  /**
   * Mirrors the workspace's member count onto the Stripe subscription item's
   * quantity — the consumer half of seat sync, called by the background
   * worker from a queue message so the membership mutation that enqueued it
   * never awaited Stripe. Every outcome but a provider/transport failure is a
   * no-op result, not an error: only a real Stripe failure rejects (and the
   * queue retries).
   */
  readonly syncSeats: (input: {
    readonly workspaceId: string
    readonly reason: string
  }) => Effect.Effect<SeatSyncResult, CapabilityUnavailable>
}

export class Billing extends Context.Service<Billing, BillingInterface>()(
  '@b2b-saas-starter/billing/Billing'
) {}
