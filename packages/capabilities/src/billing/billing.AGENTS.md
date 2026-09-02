# Billing

## Purpose & Scope

Plans, entitlements, and the Stripe handoff. The plan catalog is the starter's pricing vocabulary — the public pricing page and the workspace billing page render the same list — and `workspaces.planId` is the entitlement state that catalog gives shape to. Checkout is provider-light: with the Stripe env unset every surface keeps working and `startCheckout` fails `CapabilityUnavailable('provider_not_configured')` (CLAUDE.md rule 3).

## Module layout

Three modules, so the entitlement gate is reachable without the provider:

- `plan-catalog.ts` — `Plan`, `STARTER_PLAN`, `PLANS`, `planById`, `EntitlementResource`, `assertWithinPlanLimit`, `assertWithinPlanLimitFor`. **Imports nothing Stripe-shaped**, which is the point: `developer-platform/api-token-registry` and `webhook-endpoints.{seed,live}` import their plan gate from here, so the Stripe client never enters their dependency graph.
- `billing.ts` — `Billing` service + `BillingInterface`, `SeedBilling`, `LiveBilling`, `LiveBillingOptions`.
- `stripe.ts` — the provider adapter: the hand-rolled form-encoded REST client (`createStripeCheckoutSession`), the inbound event policy (`planForStripeEvent`, `StripeEventPlan`), and the `stripe-signature` verifier (`verifyStripeSignature`). The background worker imports the last two directly for its raw `fetch` handler; nothing here reaches for the `Billing` service.

## Public surface

- `Plan` — `{ id, name, price, description, limits: { apiTokens, webhookEndpoints }, stripePriceEnv }`. `limits` entries are `null` for unlimited. `stripePriceEnv` names the `STRIPE_PRICE_ID_*` var the deploy must set, or is `null` for a plan with no self-serve checkout (Starter needs none, Enterprise is sold). It lives **on the plan record** — there is deliberately no second table keyed by plan id, so a new plan cannot be half-declared.
- `assertWithinPlanLimit({ resource, used })` — the gate over the workspace in `WorkspaceContext`; fails `PlanLimitExceeded`.
- `assertWithinPlanLimitFor({ resource, db, capability, table, where })` — the same gate with its counting query attached. Mutating capabilities compose one of these themselves so no route handler re-derives the idiom.
- `Billing.configured` — the one definition of "Stripe is configured": secret key set, and every plan carrying a `stripePriceEnv` has a price id. The UI reads this instead of re-deriving it from env, so a page cannot report `configured: true` and then hit `price_not_configured`.
- `Billing.currentPlan` — the workspace's plan, resolved from its stored `planId`.
- `Billing.startCheckout({ planId, successUrl, cancelUrl })` — Stripe Checkout session URL; records `billing.checkout_started`.
- `Billing.applyProviderEvent({ workspaceId, planId, detail? })` — identity-keyed (an inbound webhook carries no session): updates `workspaces.planId` and batches `billing.plan_changed` with it. Resolves `false` for an unknown workspace or an unknown plan id instead of failing.

## Anti-patterns

- Don't add a second table keyed by plan id. A new per-plan fact is a field on `Plan`.
- Don't re-derive "Stripe is configured" from env in a route or a component. Read `Billing.configured`.
- Don't import `billing.ts` or `stripe.ts` to reach the plan gate — import `plan-catalog.ts`.
- Don't let `stripe.ts` depend on the `Billing` service. The event policy and the verifier run in the background worker's plain `fetch` handler, before any layer is built.
