# Recreate ssqu Booking Product in b2b-saas-starter

## Destination

Produce an agent-ready recreation plan for rebuilding `/Users/hassan/Desktop/ssqu/recreate` inside this repository as an actual Booking Product, not as the generic starter reference app. The plan covers `apps/web` as the Public Site, `apps/merchant` as the Merchant App, `apps/booking` as the Booking App, `apps/api` as the Platform API, and `apps/background` for async operations.

The first implementation target is the Booking Vertical Slice: shop or brand discovery -> service selection -> barber selection or any-barber -> available times -> customer details -> simple checkout or pay-in-person path -> appointment confirmation.

## Notes

- Tracker: local markdown in `.scratch/booking-product-recreation/`.
- Use `wayfinder` for the map, `domain-modeling` when naming product concepts, and source research against `/Users/hassan/Desktop/ssqu/recreate` when a fact can be discovered from code.
- Settled during charting: rewrite Legacy Source behavior into this repo's Cloudflare-first architecture; do not copy the legacy apps wholesale.
- Settled during charting: `apps/web` is the Public Site and public ingress, `apps/merchant` is the Merchant App, `apps/booking` is the Booking App, `apps/api` is the Platform API, and `apps/background` remains for async jobs. The Platform API is not a customer booking channel.
- Settled during charting: the first Booking Vertical Slice excludes gift cards, waiting list, walk-ins, refunds, reschedules, memberships, loyalty, and deep payment edge cases unless one is required to keep the core appointment path coherent.
- Target implementation should stay Bun-only and prefer this repo's existing React 19, TanStack, Effect, D1, Better Auth, Alchemy, Wrangler, oxfmt, and oxlint patterns.
- The map is planning by default. Do not implement product code from these tickets until the route is clear or the destination is explicitly redrawn.

## Decisions so far

- [Inventory Core Booking Source](./issues/01-inventory-core-booking-source.md) — located the Legacy Source routes, contracts, state, fixtures, payment touchpoints, and gaps that define the behavior to preserve.
- [Decide Booking Domain Model](./issues/02-decide-booking-domain-model.md) — fixed Merchant Catalog, Scheduling, and Booking as the implemented first-slice contexts and translated legacy booking language into the canonical glossary.
- [Decide App Topology and Runtime](./issues/03-decide-app-topology-and-runtime.md) — fixed the five-Worker topology, canonical origins and ports, Public Site ingress, binding ownership, public-page lifecycle, and Solo/Team information architecture.
- [Decide First-Slice Storage](./issues/04-decide-first-slice-storage.md) — made D1 authoritative for mutable state, kept Availability and readiness derived, fixed the Booking Session/Hold/Quote/Appointment snapshot boundary, and defined one deterministic Seed Booking Scenario.
- [Decide Platform API Contract](./issues/05-decide-platform-api-contract.md) — fixed the Merchant-scoped read-and-notify `/v1` surface, exact resource contracts and scopes, typed errors and rate limits, and thin PII-free Appointment webhooks.
- [Prototype Minimum Merchant Surface](./issues/06-prototype-minimum-merchant-surface.md) — selected the source-reduced operations rail as the Merchant App migration baseline and kept prototype screens disposable as production slices replace them.
- [Prototype Booking App Flow](./issues/07-prototype-booking-app-flow.md) — selected one source-faithful responsive booking journey on TanStack Start and StyleX while replacing legacy state, authorization, and domain plumbing.
- [Decide Auth and Session Boundary](./issues/08-decide-auth-and-session-boundary.md) — fixed verified Better Auth Merchant ownership, anonymous hashed Booking Session Capabilities, limited Confirmation access, and independently scoped Platform API tokens.
- [Decide Checkout Payment Boundary](./issues/09-decide-checkout-payment-boundary.md) — fixed Pay In Person as the automatic first-slice Checkout Path and deferred all payment-provider, payment-state, and collection behavior.
- [Synthesize First-Slice Implementation Plan](./issues/10-synthesize-first-slice-implementation-plan.md) — published an acyclic 18-ticket expand-contract graph that grows schema, capabilities, apps, tests, and fixtures through demoable behavior slices before final verification.

## Not yet specified

- None. The route to the destination is fully specified by the resolved decisions and linked implementation graph.

## Out of scope

- Wholesale copying `apps/app`, `apps/booking-app`, or the Node mock API into this repository as-is.
- Full feature parity in the first slice for gift cards, waiting list, walk-ins, refunds, reschedules, memberships, loyalty, and deep payment edge cases.
- Migrating the Legacy Source package manager, React 17/Redux/react-router 3 stack, or pnpm workspace shape into this repo.
- Recreating mobile/native app behavior unless a later destination redraws the scope.
- Merchant roles, multi-Merchant ownership, Provider login, and Merchant App information architecture beyond the first-slice Owner and reduced Solo/Team surfaces.
- Online payment providers, Pay Now, payment state, refunds, reconciliation, wallets, BNPL, and payment webhooks; the first slice ends at automatic Pay In Person checkout.
- Reminders, analytics, imports, feature-flag product work, and operational modules beyond durable confirmation email, thin Appointment webhooks, recovery, trace propagation, and the verification needed by this slice.
