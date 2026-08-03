# Rebuild the Legacy Booking App with Full Parity

## Destination

Produce an implementation-ready specification and dependency-ordered delivery plan for rebuilding `/Users/hassan/Desktop/ssqu/recreate/apps/booking-app` in this repository's existing `apps/booking`, with strict 1:1 customer-visible UI/UX parity and all required supporting packages, capabilities, API contracts, fixtures, and verification evidence. The plan must preserve the new Cloudflare-first, TanStack Start, Effect, and D1 architecture and recreate the legacy styled UI with StyleX.

## Notes

- Tracker: local Markdown in `.scratch/legacy-booking-app-full-parity/`.
- Parent context: [Recreate ssqu Booking Product in b2b-saas-starter](../booking-product-recreation/map.md). Its completed first-slice decisions remain valid unless a full-parity investigation exposes a concrete incompatibility.
- Use `wayfinder` for the map, `domain-modeling` for booking terminology, `research` for source/runtime inventories, and `prototype` for parity-harness or interaction questions requiring human evaluation.
- The running legacy app is the visual and behavioral authority. Source code explains unreachable states and edge cases; inferred states must be marked as inferred.
- Strict parity covers rendered visuals, copy, motion, interactions, responsive behavior, and browser-observable states. Obvious defects are documented and corrected rather than silently copied. Invisible accessibility improvements are allowed only when they do not alter the observable contract.
- Preserve the existing `apps/booking` TanStack Start and server-backed foundation, but allow substantial UI and route-composition rewrites.
- Legacy APIs and workspace packages are evidence, not permanent contracts. Map behavior into typed Effect capabilities and HTTP contracts; classify each dependency as reuse, focused recreation, absorption into a boundary, or removal.
- The legacy Booking App's visual language wins inside `apps/booking`. Encode it as a dedicated StyleX theme and reusable booking primitives; reuse repository tokens only when the rendered result matches.
- Preserve strict legacy parity for English, Spanish, and French, and add Romanian as a fourth first-class locale under the same completeness and layout contract.
- Preserve meaningful funnel telemetry behind provider-neutral adapters. Optional providers and feature flags must degrade safely when unconfigured.
- Keep merchant-slug routes canonical; provide compatibility handling for externally shareable legacy links where semantics can be preserved.
- Use deterministic fixtures across local development, screenshots, and automated tests. Product-owned legacy visual assets and translations may be reused, subject to inventory and optimization.
- Wayfinder is planning only for this effort. Do not implement the rebuild while resolving the map unless the destination is explicitly redrawn.

## Decisions so far

<!-- Resolved tickets are indexed here by name. -->

- [Inventory Legacy Booking Journeys and Observable States](./issues/01-inventory-legacy-journeys-and-observable-states.md) — fixed the complete route/journey/state surface and classified shells and error paths as runnable while data-, flag-, session-, and provider-dependent branches remain source-inferred pending deterministic fixtures.
- [Establish a Reproducible Legacy Parity Baseline](./issues/02-establish-reproducible-legacy-parity-baseline.md) — found the current local happy path non-reproducible and fixed the scenario server, environment controls, viewport matrix, capture artifacts, state procedure, and two-run stability gate required for an auditable parity authority.
- [Map Domain and Capability Gaps for Full Parity](./issues/05-map-domain-and-capability-gaps.md) — mapped every legacy journey gap to target bounded contexts and persistence/background seams, preserving the existing Cloudflare-first capability architecture while exposing the remaining domain-model decisions.
- [Classify Legacy Dependencies and Package Needs](./issues/04-classify-legacy-dependencies-and-package-needs.md) — rejected wholesale `@water-web/*` recreation, assigned behavior to existing capability/app seams, and left only a provider-neutral payments package as a conditional extraction after demonstrated reuse.
- [Inventory the Legacy Visual System, Assets, and Motion](./issues/03-inventory-visual-system-assets-and-motion.md) — fixed the source-level visual contract and its dedicated StyleX theme/primitive mapping, while isolating unproven asset redistribution rights for follow-up.

- [Define the Full-Parity Domain Model and Aggregate Invariants](./issues/14-define-full-parity-domain-model-and-aggregate-invariants.md) — fixed canonical aggregate boundaries, lifecycles, ownership, privacy rules, and atomic coordination invariants without reviving Cart, Sale Order, or Reservation.
- [Decide Route and Session Compatibility](./issues/06-decide-route-and-session-compatibility.md) — fixed progressive merchant-first selection routes, capability-protected session and private-journey access, deterministic navigation and recovery, typed query/canonicalization rules, and explicitly rejected legacy-link compatibility.
- [Decide Optional Integrations and Feature Variants](./issues/07-decide-optional-integrations-and-feature-variants.md) — retained source-backed payment, identity, gift-card, waiting-list, and walk-in variants; standardized optional consent, analytics, monitoring, and typed configuration; and retired superseded experiments and legacy trackers.
- [Decide the Localization Contract](./issues/08-decide-localization-contract.md) — fixed locale-neutral routing, session-backed selection, four complete app-owned catalogs including Romanian, merchant-content fallback, formatting and validation boundaries, and shared-layout parity constraints.
- [Prototype the StyleX Parity Architecture](./issues/09-prototype-stylex-parity-architecture.md) — validated the dedicated theme, typed semantic primitives, 375px viewport, focused motion wrappers, named layers, and boundary-only escape hatches while reserving visual-parity proof for the baseline and verification harness.
- [Establish Visual Asset Provenance and Replacement Policy](./issues/13-establish-visual-asset-provenance-and-replacement-policy.md) — prohibited unproven legacy binaries and paths, fixed licensed/provider-owned replacement rules, and required a manifest-and-CI provenance gate without weakening observable parity.

- [Prototype the Parity Verification Harness](./issues/10-prototype-the-parity-verification-harness.md) — validated a manifest-driven capture contract with deterministic fixtures, semantic interaction journeys, explicit viewport/locale/motion policies, narrowly scoped visual masking, complete evidence bundles, and independent two-run acceptance gates.
- [Decide Target Module and Package Boundaries](./issues/11-decide-target-module-and-package-boundaries.md) — kept business contexts as explicit capability subpaths and presentation/provider composition at Worker edges, with use-case-shaped APIs, one-way dependencies, and evidence-gated package extraction.
- [Synthesize the Full-Parity Implementation Plan](./issues/12-synthesize-full-parity-implementation-plan.md) — decomposed the rebuild into 16 dependency-ordered tracer slices with per-slice domain-to-evidence gates, additive migrations, full-matrix acceptance, and an ingress-level cutover and rollback strategy.

## Not yet specified

None. The route, data, delivery, verification, coexistence, cutover, and rollback decisions needed to implement the destination are specified.

## Out of scope

- Rebuilding the Merchant App, Public Site, Platform API, or Background Worker beyond changes required to support Booking App parity.
- Preserving styled-components, React Router v5, React Query v3, or the `@water-web/*` package topology as architectural constraints.
- Maintaining compatibility with legacy backend payloads as public contracts.
- Migrating private production customer data or credentials.
- Native mobile application behavior that is not observable through the legacy web Booking App.
