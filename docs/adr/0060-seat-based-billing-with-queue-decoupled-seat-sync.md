# Seat-based billing with queue-decoupled seat sync

Date: 2026-09-03

## Status

Accepted

## Context

Billing is an Optional Provider (ADR 0023): the plan catalog, entitlement gate, checkout handoff, and the inbound Stripe webhook work provider-light, with every provider touchpoint env-gated. The catalog priced every plan flat — one subscription per workspace regardless of headcount — which makes the Team plan's price a guess about team size and leaves the starter without the one B2B pattern almost every product adopts first: charge per seat.

Per-seat billing adds two provider responsibilities the starter did not have:

1. **Quantity maintenance.** A per-seat Stripe Price bills one subscription item quantity per Member. That quantity must track membership changes (a Member added, removed, or joining through an accepted Invitation) without making the membership mutation wait on a Stripe round trip, and without letting a transient Stripe outage fail an invite.
2. **Customer self-service.** Invoices, payment method, and cancellation should live in Stripe's Billing Portal rather than growing starter-owned screens for things Stripe already hosts.

## Decision

**The plan catalog owns pricing shape.** `Plan` gains `pricing: 'flat' | 'per_seat'` and `limits.seats` (included seats on a flat plan, `null` when unlimited or billed per seat). Team becomes `per_seat`; Starter stays free and flat with three included seats so the seat gate is demonstrable without a provider. A new per-plan fact is still a field on the plan record — no second table keyed by plan id.

**Seat usage is a prompt, not a refusal.** `seatUsage(plan, memberCount)` computes how the roster sits against the plan's seat terms, and the members page renders an upgrade prompt when a flat plan's included seats are passed. Unlike `assertWithinPlanLimit`, which refuses creates at a ceiling, workspaces may always add Members — an over-seat flat workspace is asked to upgrade, not blocked.

**Subscription state lives in one row per workspace.** `workspace_subscriptions` holds the Stripe customer id (the Billing Portal opens for it), the subscription and subscription-item ids, and the quantity Stripe last reported. It is written only by the billing capability from provider events; a workspace without a row has never checked out.

**Membership never awaits Stripe.** When a Member is added or removed, or an Invitation is accepted, the capability enqueues one `SeatSyncQueueMessage` onto a dedicated `BILLING_QUEUE` (a `SeatSyncPublisher` beside `WebhookPublisher`, best-effort exactly like webhook fan-out). The background worker consumes it and calls `Billing.syncSeats`, which counts the members, compares against the stored quantity, calls Stripe, and batches the `billing.seats_changed` Audit Event with the stored-quantity update. A Stripe failure retries through the queue; the membership mutation has long since returned.

**The webhook is the reconciliation authority.** The Stripe webhook handler additionally applies `customer.subscription.created` / `customer.subscription.updated` (the provider-reported quantity overwrites the stored one) and `customer.subscription.deleted` (the seat item goes, the customer survives so invoices stay reachable in the portal). Any drift between a missed queue message and reality heals on the next provider event.

**The portal is a handoff, not a surface.** `Billing.startPortalSession` creates a Stripe Billing Portal session for the workspace's stored customer and the browser leaves. Invoices, payment method, and cancellation happen there; the starter owns no screens for them. The button renders only when `Billing.configured` is true, and `billing.portal_opened` is audited like `billing.checkout_started`.

**The Seed adapter simulates provider state in memory.** `SeedBilling` holds fixture subscription rows in a `Ref` and answers `syncSeats`, `applySubscriptionEvent`, and `startPortalSession` with the same merge and audit semantics as the Live adapter, so the demo and the tests exercise seat billing with no Stripe and no D1.

## Consequences

- The audit vocabulary gains `billing.seats_changed` (system events; the queue and the webhook have no session) and `billing.portal_opened` (the acting Member).
- Membership and invitation mutations now depend on `SeatSyncPublisher` in both adapters, the same way the developer-platform capabilities depend on `WebhookPublisher`.
- The seat-sync queue has no dead-letter queue: sync is self-healing (the next membership change re-syncs; the webhook reconciles), so an exhausted message can be dropped rather than replayed. The webhook delivery queue keeps its DLQ.
- Checkout on a per-seat plan opens the subscription item at the workspace's current member count, so the first invoice is correct before any sync runs.
- Local development stays provider-light: without Stripe env vars the portal button never renders, checkout fails honestly, `syncSeats` answers `provider_not_configured`, and every other surface is unaffected.
