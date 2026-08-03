# Full-Parity Booking App Implementation Plan

## Planning contract

This plan evolves the existing server-backed Booking App in place. It does not create a parallel application, revive the legacy package graph, or postpone integration until a final merge. Every slice must leave the repository buildable, preserve the currently working provider-free appointment path, and add a vertically testable part of the resolved parity contract.

The implementation unit is a tracer slice, not a layer. A slice may change domain schemas, D1 migrations, Effect services, Worker composition, Booking HTTP contracts, deterministic fixtures, UI, localization, and tests together. A slice is complete only when its customer-observable states can be selected by a named deterministic scenario and verified without production credentials or undeclared network access.

## Dependency graph

```text
S00 contract ledger
  ├─> S01 parity infrastructure ───────────────────────────────┐
  ├─> S02 module/export and persistence foundations ─────────┐│
  └─> S03 visual/localization/asset foundations ────────────┐││
                                                            │││
S01 + S02 + S03 ─> S04 canonical shell/session/selection ───┤││
S04 ─> S05 scheduling, holds, parties, and group requests ──┤││
S05 ─> S06 pricing, policy, consent, and review ─────────────┤││
S06 ─> S07 provider-free confirmation and management ───────┤││
S06 ─> S08 payments and gift-card settlement ───────────────┤││
S07 + S08 ─> S09 cancellation, rescheduling, reminders ─────┤││
S05 + S06 ─> S10 waiting-list journeys ─────────────────────┤││
S04 + S05 ─> S11 walk-in journeys ──────────────────────────┤││
S04 + S07 ─> S12 customer identity and continuation ────────┤││
S03 + S04..S12 ─> S13 visual/state closure ─────────────────┤││
S01 + S13 ─> S14 full matrix and hardening ─────────────────┘││
S14 ─> S15 coexistence, cutover, and rollback ────────────────┘│
```

Slices S01, S02, and S03 may proceed in parallel after S00. After S04, work may proceed on independent branches only where the graph permits, but each branch must regularly rebase onto the current scenario schema and public capability subpaths.

## Cross-slice rules

1. **One owner per invariant.** Domain rules live in their capability. Route code calls journey-level use cases and never calculates availability, quotes, settlement, refunds, queue position, or transactional coordination.
2. **Additive database evolution.** Add tables and nullable/backfilled columns before switching reads or writes. Use expand/backfill/verify/contract migrations; never require a destructive migration and application switch in one deployment. Production customer-data migration is outside this effort.
3. **Transport-neutral capabilities.** Capability subpaths expose Effect services, schemas, stable typed errors, and result types. Booking owns HTTP/server-function schemas, capability cookies, redirects, serialization, and response mapping.
4. **Provider-safe defaults.** Pay In Person and anonymous booking must work with optional providers absent. Every adapter has deterministic `disabled`, `needs-configuration`, success, retryable-failure, and terminal-failure scenarios where applicable.
5. **Four-locale completeness.** Every exposed UI key and error code lands in `en`, `es`, `fr`, and `ro` in the same change. Merchant-authored content retains source-language fallback and its partial-translation indicator.
6. **Provenance before pixels.** No legacy binary enters the shipping tree until the asset manifest and CI gate authorize it. Replacements are accepted on observable role, geometry, color, crop, and timing—not byte identity.
7. **Evidence is part of the feature.** Each slice adds or updates scenario manifests, fixture state, semantic journey assertions, canonical-state assertions, and observable checkpoints. Visual baselines are updated only through reviewed evidence bundles.
8. **Intent nodes move with the architecture.** Update relevant `AGENTS.md`, `CONTEXT.md`, `ARCHITECTURE.md`, ADRs, and operations docs in the slice that changes their contract; remove first-slice prohibitions that the full-parity model has explicitly superseded.

## S00 — Freeze the contract and establish the change ledger

**Depends on:** none.

Create a machine-readable parity ledger that maps every inventoried route, journey, state, locale, viewport, integration profile, defect correction, and source-inferred branch to an owning implementation slice and named scenario. Record the accepted canonical routes, aggregate vocabulary, module graph, asset policy, and explicit retirements. Add a CI check that every ledger entry has exactly one status (`planned`, `implemented`, `verified`, or reviewed `waived`) and one owner.

This slice also updates repository intent documents to distinguish the original first vertical slice from the accepted full-parity target. It changes no runtime behavior.

**Verification:** schema/unit tests for ledger uniqueness and referential integrity; a generated coverage report has zero unowned inventory entries; repository checks remain green.

## S01 — Productionize deterministic fixtures and the parity harness

**Depends on:** S00.

Turn the accepted harness prototype into supported infrastructure. Define the versioned scenario-manifest schema; content-addressed fixture bundles; fixed clock and timezone injection; isolated run namespaces; atomic reset, snapshot, and mutation-log endpoints; deterministic provider doubles; undeclared-network blocking; and local asset serving. Build the semantic Playwright runner and evidence-bundle writer for screenshots, DOM/accessibility state, console, requests, trace/HAR, canonical state, mutation log, and video.

Start with a small smoke set covering the existing appointment path plus deliberate blank/loading/error assertions from the legacy inventory. Keep fixture data behind the same public capability contracts as Live D1; a fixture server may provide test-only reset/snapshot control but may not become a second application implementation.

**Verification:** two clean runs of every smoke scenario produce identical screenshot and canonical-state hashes; reset isolation is proven under parallel namespaces; undeclared requests and wall-clock reads fail tests; the harness works locally and in CI.

## S02 — Establish capability, export, and persistence foundations

**Depends on:** S00.

Replace the capabilities root-barrel dependency with explicit subpath exports and enforce the directed context graph. Deepen Merchant Catalog, Scheduling, Booking, Notifications, and Governance, and add owner-local `pricing`, `payments`, `gift-cards`, `waiting-list`, `walk-ins`, and `customer-identity` modules. Define stable IDs, lifecycle schemas, typed error codes, transaction-scoped internal ports, idempotency primitives, and record mappings from the accepted domain model. Do not expose Live adapters, tables, or a generic unit of work.

Add the D1 structures needed by the full model using expand-only migrations: Brand/Shop topology; composite Booking Parties and Requests; versioned quotes/adjustments/settlements; payment attempts and immutable monetary facts; gift-card sales/cards/ledger/reservations; waiting-list applications/offers; walk-in entries; policy and consent snapshots; lifecycle history; capability access; generalized notification intents and scheduled work. Backfill the existing single-request appointment fixture into the richer model without changing its behavior.

**Verification:** migration tests from an empty database and the current schema; seed/live contract tests for every new service shape; architecture tests reject forbidden cross-context imports, root-barrel use, and table access from apps; the old appointment smoke tests pass unchanged.

## S03 — Establish the booking presentation, localization, motion, and asset foundations

**Depends on:** S00.

Create the dedicated StyleX `bookingTheme`, premium boundary override, typography recipes, spacing/color/alpha/motion/layer variables, 375px viewport owner, and the minimal typed primitive set proven by the prototype. Add focused Framer Motion wrappers for presence/layout choreography and enforce named overlay layers and scroll ownership. Remove arbitrary component-level styling escape hatches.

Create bundled, versioned `en`, `es`, `fr`, and `ro` catalogs, typed translation keys, validation-code translation, locale resolution/persistence, locale-aware date/time/currency/phone formatting, and merchant-content fallback indicators. Create the visual-asset manifest schema, notices output, prohibited legacy-hash list, provenance CI gate, authorized replacements, local content-addressed test assets, and official provider-mark loading rules.

**Verification:** StyleX type/build/SSR tests; direct-link hydration checks; catalog/key/error-code completeness; long-copy and 200% zoom component tests; asset-manifest and prohibited-hash tests; primitive visual tests at layer, viewport-height, reduced-motion, pointer, and focus-visible boundaries.

## S04 — Deliver canonical shell, session authority, localization, and catalog selection

**Depends on:** S01, S02, S03.

Replace the coarse existing flow with the canonical merchant-first route tree for Shop, Provider, Service, add-ons, gift-card entry, walk-in entry, and transactional boundaries. Implement typed query allowlisting/canonicalization, `any` provider semantics, `booking` route locators, merchant-scoped HttpOnly capability cookies, per-tab Booking Parties, locale persistence, embedding profiles, acquisition capture, neutral protected-resource failures, and deterministic history behavior.

Deepen Merchant Catalog for Merchant → Brand → Shop resolution, provider/service associations, policy visibility, translated content, premium palette validation, and explicit unavailable/invalid combinations. Implement selection reconciliation and server-authoritative session version conflicts while retaining visible path intent. Unknown or unmatched routes receive localized, embedding-aware recovery instead of permanent blank UI.

**Verification:** route and HTTP contract tests for every canonical path, query and redirect rule; cookie scope and cross-merchant privacy tests; multi-tab/version-conflict tests; four-locale selection journeys; direct-link/back/forward/expiry recovery; representative standalone/widget/Google and viewport evidence.

## S05 — Deliver scheduling, holds, Booking Parties, and group requests

**Depends on:** S04.

Extend Scheduling to derived availability, provider-access policy, coordinated and replacement holds, expiry/release, offer-candidate rules, injected clock behavior, and conflict-free atomic acquisition. Extend Booking to ordered multi-request parties, assigned/any-provider resolution, service/add-on compatibility, request switching, group-appointment presentation, and earliest-incomplete-route recovery.

Preserve the single-appointment path as the first request of the richer aggregate. Correct documented legacy defects—empty professionals, empty services, and unresolved loading—using explicit localized states while retaining named legacy blank/loading states only where they are deliberate positive assertions.

**Verification:** property/integration tests for all-or-none hold acquisition, conflicts, expiry, selection invalidation, concurrency, group request ordering, and no stale-state restoration; journey evidence for standard/group, assigned/any-provider, empty/unavailable/loading, responsive, and motion states.

## S06 — Deliver pricing, promotion, policy, consent, customer details, and checkout review

**Depends on:** S05.

Implement versioned Pricing Quotes, deterministic adjustments, promotions and reservation limits, tips, settlement previews, quote invalidation, currency invariants, and exact binding to selections/holds/policies. Add immutable Checkout Policy acceptance, person-specific Marketing Consent, c15t policy resolution, customer-detail normalization and E.164 validation, and localized stable validation errors. Build Checkout V2 review and edit flows with every required request complete before checkout.

Add provider-neutral funnel events and a no-op telemetry default; consent-gated PostHog and optional Sentry remain Booking-edge adapters and cannot affect commands. Retire legacy checkout and experiment switches instead of retaining parallel UI.

**Verification:** pricing allocation and reservation property tests; stale/expired quote and policy-version tests; locale-switch-with-errors tests; consent and no-provider tests; checkout review/edit/back-forward journeys; canonical state confirms no customer-facing prose or formatted money/time crosses capability boundaries.

## S07 — Deliver provider-free confirmation, confirmation access, and appointment management

**Depends on:** S06.

Generalize atomic Pay In Person confirmation to consume every valid request/hold/reservation, create all Appointments or none, persist immutable snapshots and replay results, consume the Booking Party, and append semantically deduplicated Notification Intents. Implement confirmation route IDs, one-time token exchange, exact-purpose HttpOnly capabilities, token-free redirects, neutral recovery, and management eligibility results.

Generalize the Background Worker to durable notification intent delivery, retry, and stale-work recovery without leaking PII into queue messages or operational logs. Keep email/provider absence non-blocking for committed domain outcomes.

**Verification:** D1 transaction and idempotent replay tests; injected commit/provider/queue failures; no-partial-appointment assertions; cross-merchant and token replay/expiry tests; confirmation and recovery journeys in four locales; background retry/deduplication tests and evidence bundles.

## S08 — Deliver Payments and Gift Cards as composable settlement paths

**Depends on:** S06. Gift-card receipts additionally reuse S07 access mechanics.

Implement provider-neutral Payment lifecycles, attempts, transactions, authorization/capture/refund facts, reconciliation obligations, and idempotency. Compose Stripe at Booking and Background Worker edges for new/saved cards, Apple Pay, Google Pay, Cash App Pay, and BNPL/Klarna while retaining deterministic disabled/needs-config states and a complete Pay In Person path.

Implement assigned/unassigned Gift Card purchase, permitted amounts, recipient/purchaser details, online payment, exactly-once issuance, protected receipts, immutable value ledger, reservations, partial/full redemption, and mixed settlement. Gift-card value remains tender rather than a discount. Do not extract a workspace payment package unless a second consumer proves an implementation seam beyond capability/provider ports.

**Verification:** lifecycle/model tests; duplicate callbacks, provider success/local failure, retry/reconciliation, wallet visibility, and no-credential scenarios; gift-card issuance and overspend/currency/scope/refund invariants; mixed-settlement arithmetic; official-mark provenance checks; complete payment and gift-card state journeys.

## S09 — Deliver cancellation, rescheduling, refunds, and reminders

**Depends on:** S07, S08.

Implement cancellation eligibility separately from refund entitlement, durable retryable refund obligations, individual and explicit whole-party commands, and immutable appointment history. Implement rescheduling as a replacement session/hold/quote: preserve the Scheduled Appointment until atomic swap, and leave it unchanged on failure or expiry. Add version-bound reminders and invalidation of superseded scheduled intents.

**Verification:** cancellation-with-refund-failure tests; idempotent refund and webhook reconciliation; replacement conflicts and expiry; original-appointment-preservation assertions; reminder invalidation/deduplication; protected cancellation/rescheduling journeys and timing evidence.

## S10 — Deliver Waiting List applications, offers, and offer-driven booking

**Depends on:** S05, S06; protected link mechanics reuse S07 when available.

Implement Waiting List Application and Availability Offer lifecycles, preference capture, withdrawal, candidate derivation, at-most-one-pending-offer enforcement, sequential delivery, accept/decline/expiry/supersession, and purpose-limited offer access. Acceptance creates a bound Booking Session plus Time Slot Hold; it never creates an Appointment. Support offer-driven rescheduling through the S09 replacement command when that slice is present.

**Verification:** lifecycle and concurrency tests; sequential-offer and single-pending invariants; expiry and stale-link privacy; deterministic worker delivery; application, empty, unavailable, invalid, fulfilled, offer, and reschedule journeys.

## S11 — Deliver Walk-in enrollment and queue lifecycle

**Depends on:** S04, S05.

Implement Shop-scoped Walk-in configuration, Entry lifecycle, provider/service preference, duplicate detection, contact capture, derived ordered queue view, real position/wait projections, protected acknowledgments, and notification intents. Remove hard-coded drawer content. Enrollment remains independent of Appointments unless a later explicit conversion command invokes Booking.

**Verification:** ordering/lifecycle and duplicate tests; Shop isolation; closed/unavailable/provider-failure states; deterministic queue projections; landing, selection, enrollment, acknowledgment, and lifecycle journeys across required viewport profiles.

## S12 — Deliver optional Customer Identity and verified continuation

**Depends on:** S04, S07.

Implement Customer Account association, verification and account-session semantics, merchant-scoped ownership lookup, and recovery of purpose-limited confirmation access without rewriting historical Customer Details. Compose optional Better Auth Google and Apple providers at the Booking edge while anonymous booking remains complete. Implement provider-passcode proof as short-lived Booking Session/Provider-bound access, not customer identity or merchant authorization.

**Verification:** anonymous/verified equivalence for booking outcomes; provider disabled/needs-config/error states; account-link and merchant-isolation tests; historical snapshot immutability; access-recovery, passcode, and social-login journeys.

## S13 — Close customer-visible visual, copy, responsive, motion, and asset parity

**Depends on:** S03 and the customer journey slice being closed; run incrementally, finish after S09–S12.

Use the reproducible legacy baseline and parity ledger to replace all remaining provisional screens with exact legacy compositions: shell chrome, typography, icons/illustrations, imagery crop/fallbacks, overlays, sheets, processing, announcements, toasts, tooltips, reviews, embedding differences, pointer/hover behavior, and transition choreography. Romanian receives equivalent layout and completeness evidence; documented defects use the corrected target behavior already fixed by the contract.

Every legacy asset is either authorized through the manifest, replaced with independently licensed/product-owned work, supplied by an enabled provider, or represented by the approved generic fallback. Delete obsolete provisional components and styling only after their routes have moved and their scenarios pass.

**Verification:** reviewed exact-pixel checkpoints with only element-scoped renderer/antialias masks; timeline/video checkpoints for motion; overlay/scroll tests; four-locale shared-layout matrix; breakpoint/pointer/embedding coverage; zero unowned ledger states and zero unauthorized assets.

## S14 — Run the full parity matrix and harden operational boundaries

**Depends on:** S01 and S13, with S04–S12 complete.

Run the complete state inventory at 375×812 touch, all four locale contracts, and the representative iframe/tablet/desktop/pointer matrix. Add load/concurrency tests around hold acquisition, quote acceptance, confirmation, payment callbacks, offers, and queue writes. Audit privacy, cookie scope, token exchange, logs, telemetry consent, retries, idempotency, migration compatibility, accessibility improvements, bundle boundaries, optional-provider startup, and production configuration.

No inventory entry may remain merely source-inferred: it must have deterministic target evidence, an accepted legacy comparison, or an explicit reviewed waiver. Freeze the parity ledger and evidence report as the release candidate's acceptance record.

**Verification:** two clean full runs produce identical screenshot and canonical-state hashes; every visual, interaction, state, network, console, privacy, migration, and determinism gate passes independently; `bun run check` and production builds pass; optional bindings may all be absent without breaking provider-free booking.

## S15 — Deploy additively, cut over ingress, and retain a bounded rollback

**Depends on:** S14.

Deploy expanded D1 schema and backward-compatible Worker code before switching traffic. Validate the release candidate in an isolated environment with the same manifest/evidence suite and production-like optional-provider configuration. Because legacy URLs and backend payloads are explicitly not contracts, coexistence is at ingress/build level—not dual writes, legacy identifier translation, or shared transactional sessions.

Cut over the Public Site `BOOKING` binding/route to the new Booking App release behind an operational deployment toggle. Drain only requests already served by the old deployment; new Booking Parties begin on the new release. Keep the immediately previous compatible Worker deployment and additive schema available for a time-bounded rollback window. Rollback switches ingress/build only; it never reverses migrations or attempts to translate in-flight sessions. If new full-parity records make the previous release unsafe, roll forward with a fixed build instead.

After the agreed observation window, remove temporary deployment toggles, compatibility reads used solely during expand/backfill, obsolete schema paths, and provisional evidence waivers in a separate contract step. Production customer-data migration and credentials remain out of scope.

**Verification:** staging cutover and rollback rehearsal; synthetic provider-free and configured-provider journeys before and after switch; migration/read-compatibility checks; metrics and alerts for session creation, hold/quote/confirmation/payment/notification failures; documented go/no-go and roll-forward criteria.

## Release acceptance

Full parity is ready to release only when all of the following are true:

- Every parity-ledger entry is implemented and verified or has an explicit reviewed waiver.
- Every required observable state has a deterministic scenario and evidence bundle.
- English, Spanish, French, and Romanian catalogs and exposed error codes are complete.
- Two clean full-matrix runs have identical screenshot and canonical-state hashes.
- No undeclared network request, console error, unauthorized asset, forbidden dependency edge, or optional-provider startup dependency remains.
- Domain invariants, privacy boundaries, capability access, idempotency, migrations, retries, and operational recovery pass their independent gates.
- The existing Booking App has evolved in place; no parallel legacy architecture, generic repository/model graph, or wholesale `@water-web/*` recreation remains.
- Cutover and rollback have been rehearsed against the exact release candidate.

## Suggested implementation issue shape

Create one implementation epic per slice and smaller tracer-bullet issues inside it only when a slice cannot fit one implementation session. Each child issue must declare the customer-observable checkpoint it unlocks, its database/API/capability/UI/fixture/test touchpoints, and blocking slice. Avoid separate “all database,” “all API,” or “all UI” epics: those recreate a big-bang integration boundary and are not independently verifiable.
