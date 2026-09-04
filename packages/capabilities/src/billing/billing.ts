import { type JsonObject } from '@b2b-saas-starter/db/schema'
import { Context, type Effect } from 'effect'

import { type CapabilityUnavailable } from '../errors.ts'
import { type WorkspaceContext } from '../workspace-context.ts'
import { type Plan } from './plan-catalog.ts'

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
  const metadata: JsonObject = { planId }
  if (detail === undefined) {
    return metadata
  }
  return { ...metadata, ...detail }
}

/** The audit metadata for a seat change: the quantity plus any detail. */
export function seatChangeMetadata(quantity: number, detail?: JsonObject): JsonObject {
  const metadata: JsonObject = { quantity }
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

/** The Billing Portal handoff: same shape as checkout, different Stripe surface. */
export type PortalSession = {
  /** The Stripe-hosted Billing Portal URL to redirect the browser to. */
  readonly url: string
}

/**
 * The return of `syncSeats`: what the member-count → subscription-quantity
 * sync actually did, so the background consumer can annotate its wide event
 * without re-deriving the decision. Every non-`synced` outcome is an honest
 * no-op, not a failure — the queue message is acked.
 */
export type SeatSyncOutcome =
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
 * the subscription and seat item ids, and the seat quantity. Both adapters
 * reduce `applySubscriptionEvent` input to it through
 * {@link nextSubscriptionState}, so a deletion, a quantity report, and a
 * late-arriving link cannot be interpreted differently by the fixture and D1.
 */
export type SubscriptionState = {
  readonly customerId: string
  readonly subscriptionId: string | null
  readonly subscriptionItemId: string | null
  readonly seatQuantity: number
}

/**
 * The one reduction of a provider event onto {@link SubscriptionState} — the
 * rule both adapters enforce, so it lives here and not in either adapter:
 * an event carrying no customer for a workspace that has none stored records
 * nothing (`null`); a deletion zeroes the quantity and clears the
 * subscription ids (the customer survives for the portal's invoice history);
 * anything else keeps the ids and quantity it was not given.
 */
export function nextSubscriptionState(
  input: ApplySubscriptionEventInput,
  existing: SubscriptionState | undefined
): SubscriptionState | null {
  const customerId = input.customerId ?? existing?.customerId
  if (customerId === undefined) {
    return null
  }
  if (input.deleted === true) {
    return {
      customerId,
      subscriptionId: null,
      subscriptionItemId: null,
      seatQuantity: 0
    }
  }
  return {
    customerId,
    subscriptionId: input.subscriptionId ?? existing?.subscriptionId ?? null,
    subscriptionItemId:
      input.subscriptionItemId ?? existing?.subscriptionItemId ?? null,
    seatQuantity: input.quantity ?? existing?.seatQuantity ?? 0
  }
}

/**
 * Whether a provider event actually moved the seat count — the audit gate
 * both adapters enforce beside {@link nextSubscriptionState}: a link refresh
 * or a late-arriving item id is not a seat change, and neither is a quantity
 * that already matches the stored one.
 */
export function seatQuantityMoved(
  input: ApplySubscriptionEventInput,
  next: SubscriptionState,
  existing: SubscriptionState | undefined
): boolean {
  return (
    (input.quantity !== undefined || input.deleted === true) &&
    (existing?.seatQuantity ?? 0) !== next.seatQuantity
  )
}

/**
 * A provider-reported subscription state change, already resolved to one
 * workspace by the background worker. Identity-keyed like
 * `applyProviderEvent` — inbound webhooks and queue messages carry no
 * session. See `subscriptionLinkForStripeEvent` in `stripe.ts` for how the
 * event's fields arrive here.
 */
export type ApplySubscriptionEventInput = {
  readonly workspaceId: string
  /** The Stripe customer the Billing Portal opens for. */
  readonly customerId?: string | undefined
  readonly subscriptionId?: string | undefined
  /** The subscription item whose quantity mirrors the member count. */
  readonly subscriptionItemId?: string | undefined
  /** The provider-reported seat count, when the event carries one. */
  readonly quantity?: number | undefined
  /** True on `customer.subscription.deleted`: the seat item goes, the customer stays. */
  readonly deleted?: boolean | undefined
  /** Free-form detail for the audit metadata (event id, source). */
  readonly detail?: JsonObject | undefined
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
   * and records a `billing.checkout_started` audit event on success. On a
   * per-seat plan the session's item quantity opens at the workspace's member
   * count; later changes ride `syncSeats`.
   */
  readonly startCheckout: (
    input: CheckoutInput
  ) => Effect.Effect<CheckoutSession, CapabilityUnavailable, WorkspaceContext>
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
  }) => Effect.Effect<PortalSession, CapabilityUnavailable, WorkspaceContext>
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
  /**
   * Applies a provider-reported subscription state change (see
   * {@link ApplySubscriptionEventInput}): upserts the `workspace_subscriptions`
   * row and, when the event carries a quantity that differs from the stored
   * one, batches a `billing.seats_changed` audit event with the write.
   * Returns `false` for an unknown workspace id or an event carrying no
   * customer for a workspace that has none stored.
   */
  readonly applySubscriptionEvent: (
    input: ApplySubscriptionEventInput
  ) => Effect.Effect<boolean, CapabilityUnavailable>
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
  '@b2b-saas-starter/capabilities/Billing'
) {}
