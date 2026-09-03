# Billing

## Purpose & Scope

Plans, entitlements, and the Stripe handoff. The plan catalog is the starter's pricing vocabulary — the public pricing page and the workspace billing page render the same list — and `workspaces.planId` is the entitlement state that catalog gives shape to. Checkout is provider-light: with the Stripe env unset every surface keeps working and `startCheckout` / `startPortalSession` fail `CapabilityUnavailable('provider_not_configured')` (CLAUDE.md rule 3). Seat billing (ADR 0054) adds a per-seat pricing shape, the seat-sync queue round trip, and the Billing Portal handoff.

## Module layout

Four modules, so the entitlement gate is reachable without the provider:

- `plan-catalog.ts` — `Plan` (with `pricing: 'flat' | 'per_seat'` and `limits.seats`), `STARTER_PLAN`, `PLANS`, `planById`, `seatUsage`, `EntitlementResource`, `assertWithinPlanLimit`, `assertWithinPlanLimitFor`. **Imports nothing Stripe-shaped**, which is the point: `developer-platform/api-token-registry` and `webhook-endpoints.{seed,live}` import their plan gate from here, so the Stripe client never enters their dependency graph. `seatUsage(plan, memberCount)` is the seat half of the gate as a read: the members page prompts for an upgrade when a flat plan's included seats are passed — a prompt, never a refusal.
- `billing.ts` — the contract: `Billing` service + `BillingInterface`, `CheckoutInput` / `PortalSession`, `SeatSyncResult`, `ApplySubscriptionEventInput`, and the audit-metadata helpers both adapters share. No adapters live here.
- `billing.seed.ts` / `billing.live.ts` — `SeedBilling` and `LiveBilling` + `LiveBillingOptions`. Seed simulates subscription state (customer, seat item, quantity) in a `Ref` seeded from `options.subscriptions`, and counts the shared seed roster for seat sync; Live reads `workspaces.planId` and `workspace_subscriptions` and calls the provider through `stripe.ts`.
- `stripe.ts` — the provider adapter: the hand-rolled form-encoded REST client (`createStripeCheckoutSession` with a per-seat `quantity`, `createStripeBillingPortalSession`, `updateStripeSubscriptionItemQuantity`), the two inbound event policies (`planForStripeEvent`, `subscriptionLinkForStripeEvent` with `StripeSubscriptionLink`), and the `stripe-signature` verifier (`verifyStripeSignature`). The background worker imports the policies and the verifier directly for its raw `fetch` handler; nothing here reaches for the `Billing` service.
- `seat-sync.ts` — the producer half of seat sync: `SeatSyncQueueMessage` (shared wire schema with the background worker's consumer), the `SeatSyncQueueBinding` port, the `SeatSyncPublisher` service, and `publishSeatSyncWith` (best-effort, like `publishWebhookEventWith`).

## Public surface

- `Plan` — `{ id, name, price, description, pricing, limits: { apiTokens, webhookEndpoints, seats }, stripePriceEnv, purchase }`. `limits` entries are `null` for unlimited; `limits.seats` is the flat plan's included-seat ceiling and `null` on per-seat plans, which bill every Member instead of capping them. `stripePriceEnv` names the `STRIPE_PRICE_ID_*` var the deploy must set, or is `null` for a plan with no self-serve checkout (Starter needs none, Enterprise is sold). Every per-plan fact lives **on the plan record** — there is deliberately no second table keyed by plan id, so a new plan cannot be half-declared.
- `assertWithinPlanLimit({ resource, used })` — the gate over the workspace in `WorkspaceContext`; fails `PlanLimitExceeded`.
- `assertWithinPlanLimitFor({ resource, db, capability, table, where })` — the same gate with its counting query attached. Mutating capabilities compose one of these themselves so no route handler re-derives the idiom.
- `seatUsage(plan, memberCount)` — `{ pricing, included, used, overLimit }`; `overLimit` is true only on a flat plan past its included seats.
- `Billing.configured` — the one definition of "Stripe is configured": secret key set, and every plan carrying a `stripePriceEnv` has a price id. The UI reads this instead of re-deriving it from env, so a page cannot report `configured: true` and then hit `price_not_configured`. The Manage-billing button renders behind this same predicate.
- `Billing.currentPlan` — the workspace's plan, resolved from its stored `planId`.
- `Billing.startCheckout({ planId, successUrl, cancelUrl })` — Stripe Checkout session URL; on a per-seat plan the item quantity opens at the workspace's member count. Records `billing.checkout_started`.
- `Billing.startPortalSession({ returnUrl })` — a Stripe Billing Portal session URL for the workspace's stored customer; invoices, payment method, and cancellation live there. Fails `no_billing_profile` before the first checkout. Records `billing.portal_opened`.
- `Billing.applyProviderEvent({ workspaceId, planId, detail? })` — identity-keyed (an inbound webhook carries no session): updates `workspaces.planId` and batches `billing.plan_changed` with it. Resolves `false` for an unknown workspace or an unknown plan id instead of failing.
- `Billing.applySubscriptionEvent({ workspaceId, customerId?, subscriptionId?, subscriptionItemId?, quantity?, deleted?, detail? })` — upserts the `workspace_subscriptions` row; when the event moves the quantity, batches `billing.seats_changed` with the write. `deleted: true` clears the subscription/item ids and zeroes the quantity; the customer survives so the portal keeps the invoice history.
- `Billing.syncSeats({ workspaceId, reason })` — the consumer half of seat sync: counts the members, compares against the stored quantity, calls Stripe, and batches the audit event with the stored update. Every outcome but a provider failure is a no-op result (`no_subscription`, `no_seat_item`, `quantity_unchanged`, `provider_not_configured`); only a real Stripe failure rejects, so the queue retries.

## How seat sync flows

`WorkspaceMembership.addMember` / `.removeMember` and `WorkspaceInvitations.accept` call `publishSeatSyncWith(publisher, { workspaceId, reason })` **after** their write — best-effort; a queue outage annotates the wide event and never fails the mutation. The background worker's `seat-sync-consumer.ts` decodes `SeatSyncQueueMessage` and hands it to `Billing.syncSeats`. The Stripe webhook handler reconciles on `customer.subscription.updated`, so provider-reported truth wins over anything a missed message left behind. See ADR 0054.

## Anti-patterns

- Don't add a second table keyed by plan id. A new per-plan fact is a field on `Plan`.
- Don't re-derive "Stripe is configured" from env in a route or a component. Read `Billing.configured`.
- Don't import `billing.ts`, `stripe.ts`, or the adapters to reach the plan gate or `seatUsage` — import `plan-catalog.ts`.
- Don't let `stripe.ts` depend on the `Billing` service. The event policies and the verifier run in the background worker's plain `fetch` handler, before any layer is built.
- Don't call Stripe from a membership mutation, or await `syncSeats` anywhere on the request path. The queue is the seam (ADR 0054).
- Don't block member management at a seat ceiling. Seats prompt (`seatUsage`); resource ceilings refuse (`assertWithinPlanLimit`).
