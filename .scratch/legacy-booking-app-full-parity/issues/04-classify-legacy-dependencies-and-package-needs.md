# Classify Legacy Dependencies and Package Needs

Type: research
Status: resolved
Blocked by: 01

## Question

For every direct dependency, `@water-web/*` import surface, local abstraction, and external provider used by the legacy Booking App, should the new system reuse an existing repository package, recreate a focused package, absorb the behavior into an app or capability boundary, replace it with a modern equivalent, or remove it—and why?

## Answer

The exhaustive source-cited classification is recorded in [Legacy Dependency Disposition Inventory](../research/legacy-dependency-disposition-inventory.md).

The rebuild should not recreate any `@water-web/*` package wholesale. Reuse the repository's existing capabilities, database, auth, logger, environment, configuration, React/Vite, TanStack, Effect, and StyleX foundations. Move legacy domain invariants and schemas into their owning catalog, scheduling, booking, notification, auth/customer, or payment capability boundaries; keep route/query composition, UI primitives, localization, consent, embedding state, presentation helpers, Stripe Elements, and browser-provider adapters inside `apps/booking`.

Replace the React Router v5, React Query v3, styled-components/styled-system, runtime locale-loading, proxy-mutation, clipboard, legacy form/input, and provider-owned authentication implementations with the target architecture or small owner-local equivalents. Remove the global types bucket, repository model graph, `@water-web/view` facade, deep imports, provider-coupled bridges, and nonessential trackers from the default build. Sentry can reuse the catalogued dependency; analytics, ads, flags, social login, maps, bot protection, and payments must remain optional adapters with safe disabled states.

The only plausible new shared package is a narrow provider-neutral payments package exposing Effect services and schemas. It should initially remain within the booking-checkout capability and be extracted only when a second consumer or a proven server/browser adapter seam justifies it. No newly surfaced investigation ticket is needed: “Decide Optional Integrations and Feature Variants” owns provider retention, while “Decide Target Module and Package Boundaries” owns the final extraction decision.
