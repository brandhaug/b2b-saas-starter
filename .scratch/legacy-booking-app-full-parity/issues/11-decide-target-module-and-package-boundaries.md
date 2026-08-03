# Decide Target Module and Package Boundaries

Type: grilling
Status: resolved
Blocked by: 04, 05, 06, 07, 08, 09, 14

## Question

Given the observed reuse and dependency evidence, what responsibilities remain private to `apps/booking`, what new shared packages or capability modules are justified, what APIs do they expose, and how do those boundaries avoid both a monolithic port and premature package extraction?

## Answer

The full-parity rebuild adds no new workspace package. Business behavior remains in `packages/capabilities`, split into explicit bounded-context modules. Booking presentation and browser integration remain private to `apps/booking`. Extraction into another workspace package requires demonstrated reuse by a second application or a runtime/tooling boundary that `packages/capabilities` cannot cleanly express; coordination by several capability modules is not sufficient evidence.

### Capability modules

Deepen the existing Merchant Catalog, Scheduling, Booking, Notifications, and Governance modules. Add focused `pricing`, `payments`, `gift-cards`, `waiting-list`, `walk-ins`, and `customer-identity` modules inside `packages/capabilities`. Payments does not become `packages/payments`: provider-neutral payment behavior belongs in the Payments capability, while concrete server and browser adapters stay at runtime composition edges.

Customer Identity remains separate from both Booking and the merchant-facing `packages/auth` authority. It owns optional Customer Account association, verification, account-session semantics, and privacy-scoped ownership lookup. Booking accepts an optional verified customer reference while preserving anonymous capability access and immutable Customer Details snapshots.

`packages/db` remains persistence infrastructure. It owns D1/Drizzle mechanics, tables, migrations, transaction primitives, and storage record types, while each capability owns its domain schemas, invariants, commands, results, typed errors, and record mappings. Applications cannot import tables to bypass capabilities, and the rebuild introduces neither a generic repository layer nor a global model/types package.

### Private Booking App responsibilities

The StyleX booking theme and primitives, route/query composition, TanStack loaders and query adapters, form and transient presentation state, bundled localization catalogs, locale-aware formatting, consent UI, browser telemetry adapters, Stripe Elements and wallet detection, OAuth UI, maps, Turnstile presentation, and other browser SDK integrations remain private to `apps/booking`. There is no shared booking-UI or localization package without a demonstrated second consumer; this prevents recreating the legacy `@water-web/view` facade.

`apps/booking` also owns its private HTTP/server-function contracts, capability-cookie handling, serialization, and capability-error-to-response mapping. Capability schemas remain transport-neutral. Each Worker owns the transport contract for its audience, and `apps/api` does not become the Booking App backend.

### Public APIs and exports

Replace the expanding root barrel with explicit bounded-context subpath exports such as `@b2b-saas-starter/capabilities/booking`, `/pricing`, `/payments`, `/gift-cards`, `/waiting-list`, `/walk-ins`, `/customer-identity`, `/merchant-catalog`, `/scheduling`, and `/notifications`. Each public subpath exposes only Effect service contracts, schemas, typed errors, and stable result types. Live and Seed implementations, persistence helpers, and transaction-scoped ports stay behind dedicated runtime/testing or package-internal entry points.

The Booking App consumes journey-level, use-case-shaped APIs rather than coordinating low-level contexts itself. The route-facing surface covers booking selection, scheduling, checkout, confirmation, cancellation, and rescheduling; gift-card purchase and receipt; waiting-list application and offer acceptance; walk-in enrollment and status; and customer continuation and ownership recovery. These operations return complete typed results for rendering. Route code never calculates quotes, drives Payment lifecycles, acquires holds, or coordinates transactions.

### Orchestration and dependency direction

Workflow orchestration belongs to the context that owns the customer outcome:

- Booking coordinates confirmation, cancellation, and rescheduling.
- Gift Cards coordinates gift-card purchase and exactly-once issuance.
- Waiting List coordinates application and offer acceptance into a purpose-bound Booking Session and hold.
- Walk-ins coordinates queue lifecycle independently of Booking unless an explicit conversion command later creates a booking.
- Pricing, Payments, Scheduling, Merchant Catalog, Customer Identity, and Notifications expose narrow operations and never reach into another context's persistence.

Atomic multi-context work uses package-internal transaction-scoped ports, not a public generic workflow or unit-of-work abstraction. Merchant Catalog is foundational; Scheduling and Pricing may depend on its contracts. Payments, Gift Cards, Customer Identity, and Notifications retain independent ownership. Booking may orchestrate Catalog, Scheduling, Pricing, Payments, Gift Cards, and notification-intent recording. Waiting List may request Scheduling candidates and invoke a narrow Booking port. Walk-ins may consume Catalog policy and append notification intents. Lower-level contexts never import Booking, and no context imports another context's Live adapter or database tables. Explicit subpath exports plus dependency tests or lint rules enforce this directed graph.

### Provider and Worker placement

`apps/booking` owns request-time provider adapters, including Stripe checkout/setup, Turnstile verification, consent-gated browser analytics, OAuth UI, maps, and wallet detection. `apps/background` owns asynchronous payment reconciliation and Webhook handling, email/SMS delivery, reminders, waiting-list delivery, and retry processing. Capabilities define the provider-neutral ports and durable facts shared by those runtimes. Existing focused infrastructure packages such as `packages/email` remain reusable.

A concrete provider-integration package is justified only when both runtimes demonstrably require the same implementation. Every optional adapter exposes disabled or needs-configuration behavior without weakening domain invariants.

These boundaries avoid a monolithic port by giving each domain lifecycle an owned capability and a one-way dependency seam. They avoid premature extraction by keeping presentation local, persistence mechanical, adapters runtime-owned, and package creation evidence-gated. No canonical business term changed, so `CONTEXT.md` requires no update from this decision.
