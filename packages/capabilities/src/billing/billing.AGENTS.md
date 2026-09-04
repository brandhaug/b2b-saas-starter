# Billing

## Purpose & Scope

Plan catalog, entitlement gates, and the Stripe handoff, seat billing included (ADR 0060). With the Stripe env unset every surface still works; `startCheckout` and `startPortalSession` fail `CapabilityUnavailable('provider_not_configured')`.

## Entry Points & Contracts

- `plan-catalog.ts` imports nothing Stripe-shaped: reach the plan gate and `seatUsage` from there, never through `billing.ts` or an adapter, so the Stripe client stays out of `api-token-registry` and `webhook-endpoints`.
- Every per-plan fact lives on the `Plan` record, `stripePriceEnv` included; a second table keyed by plan id would let a plan be half-declared.
- `Billing.configured` is the one definition of configured (secret key plus a price id per `stripePriceEnv` plan), so no page claims configured then hits `price_not_configured`.
- `seatUsage` prompts for an upgrade past a flat plan's included seats; `assertWithinPlanLimit` refuses. Seats never block member management.
- `applyProviderEvent` and `applySubscriptionEvent` are identity-keyed by `workspaceId` (an inbound webhook has no session) and resolve `false` on an unknown workspace or plan. `deleted: true` clears subscription and item ids but keeps the customer, so the portal keeps invoices.
- `syncSeats` returns a no-op result for every outcome except a provider failure; only a real Stripe failure rejects, which is what makes the queue retry.
- Audits `billing.checkout_started`, `.portal_opened`, `.plan_changed`, `.seats_changed`.

## Patterns & Pitfalls

- Membership and invitation writes publish `SeatSyncQueueMessage` afterwards, best-effort, and the background consumer calls `syncSeats`. The Stripe webhook reconciles on `customer.subscription.updated`, beating any dropped message.

## Anti-patterns

- No re-deriving "Stripe is configured" from env in a route or component.
- No dependency from `stripe.ts` on the `Billing` service: its event policies and signature verifier run in the worker's plain `fetch` handler, before any layer exists.
- No Stripe call from a membership mutation, and no awaited `syncSeats` on a request path. The queue is the seam (ADR 0060).
