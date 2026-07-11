# Tickets: Legacy Booking App Full Parity

These tickets evolve the existing Booking Product to the observable full-parity contract defined in the [source spec](.scratch/legacy-booking-app-full-parity/PRD.md).

Work the **frontier**: any ticket whose blockers are all done. Tickets are ordered with blockers before the work they unlock.

## Freeze the Full-Parity Contract Ledger

**What to build:** Give maintainers one machine-readable authority that assigns every accepted legacy route, journey, observable state, locale, viewport, embedding profile, integration profile, corrected defect, and source-inferred branch to a named deterministic scenario and implementation owner.

**Blocked by:** None — can start immediately.

- [x] Every accepted inventory item has exactly one owner, one named scenario, and one status: planned, implemented, verified, or explicitly waived.
- [x] Canonical routes, aggregate vocabulary, module boundaries, asset policy, corrected legacy defects, and explicit retirements are represented.
- [x] Referential-integrity checks reject missing, duplicate, or orphaned ledger entries.
- [x] A generated coverage report shows zero unowned entries.
- [x] Repository intent documents distinguish the original Booking Vertical Slice from the accepted full-parity target without changing runtime behavior.

## Productionize the Deterministic Parity Harness

**What to build:** Let maintainers select a named scenario and reproducibly exercise the real Booking journey with controlled state, time, providers, networking, and a reviewable evidence bundle.

**Blocked by:** Freeze the Full-Parity Contract Ledger.

- [x] Scenario manifests and fixture bundles are versioned, validated, and content-addressed.
- [x] Runs use an injected clock and timezone, isolated namespaces, and atomic reset and snapshot controls.
- [x] Optional providers have deterministic doubles and undeclared network requests fail the run.
- [x] Evidence captures semantic assertions, canonical server state, mutation history, screenshots, accessibility/DOM state, console output, requests, and traces.
- [x] Two clean runs of every initial smoke scenario produce identical canonical-state and screenshot hashes.
- [x] The existing Pay In Person appointment path and deliberate blank, loading, and error states run locally and in CI.

## Expand Capability and Persistence Foundations

**What to build:** Expand the target domain and persistence model beside the current first-slice model so later customer journeys can land incrementally without breaking the existing appointment path.

**Blocked by:** Freeze the Full-Parity Contract Ledger.

- [x] Explicit capability subpaths expose transport-neutral Effect services, schemas, results, stable IDs, typed errors, and lifecycle contracts.
- [x] Additive D1 evolution supports Brand and Shop topology, Booking Parties and Requests, quote and settlement facts, payments, gift cards, waiting lists, walk-ins, policy facts, lifecycle history, protected access, Notification Intents, and scheduled work.
- [x] Existing first-slice data and deterministic fixtures are backfilled into the richer model without observable regression.
- [x] Migrations succeed from both an empty database and the current schema.
- [x] Seed and live implementations satisfy the same public capability contracts.
- [x] Architecture checks reject forbidden cross-context dependencies, root-barrel capability imports, application-level table access, and exposed Live adapters.

## Establish Booking Presentation and Localization Foundations

**What to build:** Give every Booking journey a typed, accessible presentation and four-locale foundation that can reproduce the accepted visual behavior without arbitrary styling or customer-facing prose leaking from capabilities.

**Blocked by:** Freeze the Full-Parity Contract Ledger.

- [ ] A dedicated Booking theme defines controlled typography, spacing, color, alpha, motion, responsive, and layer contracts.
- [ ] Typed primitives cover the proven shell, interaction, feedback, overlay, and form needs without arbitrary styling escape hatches.
- [ ] Named overlay layers, scroll ownership, presence choreography, focus behavior, and reduced-motion behavior are enforced.
- [ ] Bundled English, Spanish, French, and Romanian catalogs share complete typed keys and stable error-code translations.
- [ ] Locale resolution, persistence, and date, time, currency, and phone formatting are deterministic and independent of scheduling and monetary invariants.
- [ ] Merchant-authored untranslated content uses source-language fallback with an explicit indicator.
- [ ] Direct-link hydration, long copy, 200% zoom, viewport-height, keyboard, pointer, and focus-visible checks pass.

## Establish Visual Asset Provenance Controls

**What to build:** Allow visual parity assets to ship only when their origin and permitted use are known, while supplying deterministic replacements and provider marks for every required customer-visible role.

**Blocked by:** Freeze the Full-Parity Contract Ledger.

- [ ] Every shipping visual binary is described by an asset manifest with source, license or ownership, allowed role, and integrity identity.
- [ ] Known prohibited legacy hashes are rejected automatically.
- [ ] Independently licensed or product-owned replacements are accepted by observable role, geometry, crop, color, and timing rather than byte identity.
- [ ] Tests use local content-addressed assets without undeclared network access.
- [ ] Official provider marks load only under their approved provider and provenance rules.
- [ ] Generated notices and CI checks fail on missing or unauthorized assets.

## Deliver the Canonical Booking Shell and Session Boundary

**What to build:** Let a customer enter, continue, navigate, and recover a merchant-first Booking journey through canonical routes and a private, server-authoritative Booking Session.

**Blocked by:** Productionize the Deterministic Parity Harness; Expand Capability and Persistence Foundations; Establish Booking Presentation and Localization Foundations; Establish Visual Asset Provenance Controls.

- [ ] Canonical merchant-first routes cover customer selection, transactional entry points, gift cards, walk-ins, and recovery states.
- [ ] Query allowlisting, canonicalization, redirects, acquisition capture, embedding profiles, and deterministic history behavior match the accepted contract.
- [ ] Merchant-scoped HttpOnly capabilities isolate one Booking Session and Booking Party per tab.
- [ ] Locale selection persists through continuation and confirmation without entering route identity.
- [ ] Version conflicts, expiry, direct links, back and forward navigation, invalid links, and unmatched routes preserve valid intent and offer localized recovery.
- [ ] Protected-resource failures are neutral and do not reveal cross-merchant existence.
- [ ] Representative standalone and embedded scenarios pass across required viewports and locales.

## Deliver Merchant, Brand, Shop, and Catalog Selection

**What to build:** Let customers resolve the intended Merchant, Brand, and Shop and select only customer-visible Provider and Service combinations that are currently valid.

**Blocked by:** Deliver the Canonical Booking Shell and Session Boundary.

- [ ] Merchant configuration resolves explicitly through Brand and Shop precedence and downstream facts can snapshot the resolved values.
- [ ] Customers can choose a Shop, Provider preference, Primary Service, and Additional Services only when the combination is eligible.
- [ ] Specific Provider, Any Provider, restricted Provider, inactive entity, and invalid association states are explicit.
- [ ] Translated catalog content and validated premium palette overrides render through the Booking presentation contract.
- [ ] Server-authoritative selection reconciliation removes or explains stale combinations without restoring invalid client state.
- [ ] Empty, unavailable, invalid, and provider-restricted scenarios have localized recovery in all supported locales.

## Deliver Single-Request Availability and Time Slot Holds

**What to build:** Let a customer choose a genuinely available Time Slot and hold it exclusively while completing one Booking Request.

**Blocked by:** Deliver Merchant, Brand, Shop, and Catalog Selection.

- [ ] Availability derives from Schedule Rules, service duration, Provider eligibility, Provider preference, existing commitments, and injected time.
- [ ] Specific Provider and Any Provider choices resolve deterministically and never expose an ineligible Provider.
- [ ] Hold acquisition is atomic and conflict-free under concurrency.
- [ ] Expiry, release, replacement, selection invalidation, and stale-state recovery are explicit and clock-driven.
- [ ] Deliberate legacy blank or loading states remain only where named by the ledger; documented unresolved-loading and empty-state defects are corrected.
- [ ] Property, concurrency, and journey scenarios cover available, empty, unavailable, loading, conflict, expiry, and recovery behavior.

## Deliver Composite Booking Parties and Group Holds

**What to build:** Let one coordinator assemble ordered Booking Requests for multiple guests and reserve every required Time Slot as one coherent Booking Party.

**Blocked by:** Deliver Single-Request Availability and Time Slot Holds.

- [ ] A Booking Party supports one or more ordered Booking Requests without changing the existing single-request behavior.
- [ ] Each request owns its guest details, selected services, resolved Provider, and held interval.
- [ ] Coordinated hold acquisition succeeds for the complete conflict-free set or acquires none.
- [ ] The customer can add, remove, reorder, and switch requests while material changes reconcile dependent state.
- [ ] Continuation returns to the earliest incomplete request and never restores stale selections or holds.
- [ ] Group scenarios cover assigned and Any Provider resolution, conflicts, expiry, responsive presentation, and motion.

## Deliver Pricing, Promotions, and Quote Acceptance

**What to build:** Give a customer an immutable, understandable price proposal for the complete Booking Party and require explicit acceptance whenever material facts change.

**Blocked by:** Deliver Composite Booking Parties and Group Holds.

- [ ] Pricing Quotes are immutable, versioned, single-currency, and bound to exact requests, holds, policy versions, promotions, tips, and gift-card reservations.
- [ ] Discounts, tax, fees, and tips appear as named Pricing Adjustments with deterministic allocation where required.
- [ ] Server-owned Promotions validate eligibility and reserve limited uses without trusting client calculations.
- [ ] Material changes, expiry, or invalid dependencies make the accepted quote unconfirmable rather than silently repricing it.
- [ ] Stale, superseded, and expired quote states have stable localized recovery.
- [ ] Arithmetic, allocation, reservation, concurrency, and locale-switch scenarios prove monetary invariants.

## Deliver Customer Details, Policies, Consent, and Checkout Review

**What to build:** Let a customer complete every guest's details, understand and accept applicable policy, control marketing consent, and review or edit the whole Booking Party before confirmation.

**Blocked by:** Deliver Pricing, Promotions, and Quote Acceptance.

- [ ] Customer Details are normalized and validated with stable localized errors, including E.164-compatible phone behavior.
- [ ] Each exposed error remains correctly associated when the customer changes locale.
- [ ] Policy resolution follows accepted configuration precedence and acceptance snapshots the exact disclosure and version once for the Booking Party.
- [ ] Marketing Consent is person-specific and independent of Operational Notifications.
- [ ] Checkout review requires every Booking Request to be complete and shows the accepted quote and policy facts.
- [ ] Editing a material fact invalidates and rebuilds only the dependent state required by the contract.
- [ ] Provider-neutral funnel events use a no-op default; consent-gated analytics and optional error reporting cannot affect commands.

## Deliver Provider-Free Confirmation and Protected Access

**What to build:** Let a customer atomically confirm a complete Pay In Person Booking Party, safely retry after uncertainty, and privately access the resulting confirmation without an account.

**Blocked by:** Deliver Customer Details, Policies, Consent, and Checkout Review.

- [ ] Confirmation consumes every valid request, hold, reservation, accepted quote, and policy fact in one local commit or creates no Appointments.
- [ ] One Appointment is created per Booking Request with immutable customer-visible snapshots and independent lifecycle identity.
- [ ] Identical retries return the committed result; conflicting or expired retries cannot duplicate Appointments.
- [ ] Unresolved settlement or commitment is shown as Processing rather than a partial confirmation.
- [ ] Confirmation links exchange one-time tokens for exact-purpose HttpOnly access and redirect to token-free URLs.
- [ ] Replay, expiry, invalid purpose, and cross-merchant access use neutral localized recovery.
- [ ] Pay In Person works with all optional providers absent in every supported locale.

## Deliver Durable Operational Notifications

**What to build:** Ensure committed Booking outcomes create and deliver the right operational notifications durably without coupling domain success to email or provider availability.

**Blocked by:** Deliver Provider-Free Confirmation and Protected Access.

- [ ] Domain commits append semantically deduplicated Notification Intents containing committed facts.
- [ ] Queue messages and operational logs contain identifiers rather than Customer Details or bearer secrets.
- [ ] Delivery is at least once, retryable, idempotent, and recoverable after stale work or worker interruption.
- [ ] Disabled, needs-configuration, retryable-failure, terminal-failure, and success provider states are deterministic.
- [ ] Provider or queue failure never rolls back a committed Appointment.
- [ ] Duplicate delivery, recovery, and provider-free scenarios prove the observable notification status.

## Deliver Online Payment Settlement

**What to build:** Let a payer settle an accepted Pricing Quote through configured online methods while keeping provider failures, retries, and local commitment safe and understandable.

**Blocked by:** Deliver Customer Details, Policies, Consent, and Checkout Review.

- [ ] Payment owns idempotent attempts and immutable authorization, capture, refund, and reconciliation facts.
- [ ] Payment status derives only from successful monetary facts; failed provider operations remain Payment Attempt facts.
- [ ] Configured cards, saved methods, Apple Pay, Google Pay, Cash App Pay, and BNPL variants expose only eligible methods.
- [ ] Pay In Person remains available and creates no Payment.
- [ ] Duplicate callbacks, provider success followed by local failure, retries, reconciliation, cancellation, and no-credential states cannot duplicate collection.
- [ ] Customer-visible processing, failure, retry, and success states are localized and selected by deterministic scenarios.

## Deliver Gift Card Purchase and Issuance

**What to build:** Let a purchaser buy permitted assigned or unassigned Gift Card value and receive exactly one protected issued card after successful settlement.

**Blocked by:** Deliver Provider-Free Confirmation and Protected Access; Deliver Online Payment Settlement.

- [ ] Gift Card Product rules enforce permitted amount, currency, and Merchant, Brand, Shop, or Provider scope.
- [ ] Purchaser and optional recipient details are captured without creating unintended Customer identity.
- [ ] A captured Gift Card Sale issues exactly one Gift Card under retry, callback, and reconciliation scenarios.
- [ ] Protected receipts reuse purpose-limited access mechanics and avoid bearer secrets in URLs after exchange.
- [ ] Sale cancellation, refund, provider failure, and local failure preserve immutable monetary and issuance facts.
- [ ] Official payment and wallet marks comply with asset provenance controls.

## Deliver Gift Card Redemption and Mixed Settlement

**What to build:** Let a customer reserve and redeem Gift Card value as tender, combine it with external Payment where needed, and preserve exact value accounting through confirmation and refunds.

**Blocked by:** Deliver Pricing, Promotions, and Quote Acceptance; Deliver Online Payment Settlement; Deliver Gift Card Purchase and Issuance.

- [ ] Gift Card value uses an immutable ledger and cannot exceed available balance or cross fixed currency and scope.
- [ ] Checkout reservations prevent concurrent overspend and release on expiry or abandonment.
- [ ] Partial, full, and mixed settlement allocations equal the accepted Pricing Quote total without changing its price.
- [ ] Confirmation commits gift-card and external-payment allocations exactly once with the Booking Party.
- [ ] Refunds reverse original settlement allocations and cannot void already-spent value without an explicit adjustment rule.
- [ ] Concurrency, expiry, overspend, mixed-settlement, refund, and retry scenarios prove the invariants.

## Deliver Cancellation and Refund Obligations

**What to build:** Let a customer cancel one Appointment or explicitly cancel the whole party while recording any owed refund as an independently retryable obligation.

**Blocked by:** Deliver Provider-Free Confirmation and Protected Access; Deliver Online Payment Settlement; Deliver Gift Card Redemption and Mixed Settlement.

- [ ] Cancellation eligibility and refund entitlement are evaluated separately from Appointment status.
- [ ] Individual cancellation does not silently affect sibling Appointments; whole-party cancellation is explicit and atomic where required.
- [ ] Appointment history preserves immutable prior facts and the reason for lifecycle changes.
- [ ] Cancellation may commit when a refund provider is unavailable, leaving an idempotent retryable refund obligation.
- [ ] External-payment and Gift Card reversals preserve the original settlement allocations.
- [ ] Duplicate commands, provider failures, webhook reconciliation, protected access, and cross-merchant scenarios cannot duplicate refunds or leak Appointment existence.

## Deliver Atomic Rescheduling and Versioned Reminders

**What to build:** Let a customer safely move a Scheduled Appointment while preserving the original booking until the replacement is ready, and ensure reminders refer only to the current version.

**Blocked by:** Deliver Durable Operational Notifications; Deliver Cancellation and Refund Obligations.

- [ ] Rescheduling uses a purpose-bound replacement session, Time Slot Hold, Pricing Quote, and required policy facts.
- [ ] The original Appointment remains Scheduled and unchanged while replacement work is incomplete, expired, or failed.
- [ ] Commit swaps the time, Provider, price facts, and history atomically under concurrency.
- [ ] Material price or settlement changes follow the accepted quote and refund rules rather than mutating history.
- [ ] Reminder intents are bound to an Appointment version and obsolete pending reminders are invalidated.
- [ ] Conflict, expiry, retry, failure, success, duplicate command, and stale-reminder scenarios prove preservation and deduplication.

## Deliver Waiting List Applications and Availability Offers

**What to build:** Let a customer register availability preferences and receive private, sequential offers that create a held Booking Session for checkout rather than silently creating an Appointment.

**Blocked by:** Deliver Single-Request Availability and Time Slot Holds; Deliver Customer Details, Policies, Consent, and Checkout Review; Deliver Provider-Free Confirmation and Protected Access.

- [ ] Customers can create, inspect, and withdraw Waiting List Applications with Shop, service, Provider, and time preferences.
- [ ] Candidate derivation respects current eligibility and allows at most one Pending Availability Offer per application.
- [ ] Offers are delivered sequentially and support accept, decline, expiry, and supersession without leaking candidate identity.
- [ ] Acceptance atomically consumes the offer and creates a purpose-bound Booking Session plus Time Slot Hold, not an Appointment.
- [ ] Declined and expired offers can leave the application Active; fulfilled, withdrawn, and expired lifecycles are explicit.
- [ ] Deterministic worker, concurrency, stale-link, empty, invalid, fulfilled, and offer-driven rescheduling scenarios pass.

## Deliver Walk-in Enrollment and Queue Lifecycle

**What to build:** Let a customer join a configured Shop's walk-in queue, understand their derived position and wait projection, and receive lifecycle acknowledgements based on real merchant state.

**Blocked by:** Deliver Merchant, Brand, Shop, and Catalog Selection; Deliver Single-Request Availability and Time Slot Holds; Deliver Durable Operational Notifications.

- [ ] Shop-scoped configuration controls whether walk-ins are open and which Services and Provider preferences are eligible.
- [ ] Enrollment captures required contact details and rejects duplicates deterministically.
- [ ] Queue position and wait projections derive from real ordered entries rather than hard-coded presentation data.
- [ ] Waiting, Called, Serving, Served, Removed, and Expired transitions preserve Shop isolation and history.
- [ ] Protected acknowledgements and Notification Intents follow the same privacy and delivery contracts as Booking.
- [ ] Closed, empty, unavailable, duplicate, provider-failure, lifecycle, locale, and viewport scenarios pass.

## Deliver Optional Customer Identity and Verified Continuation

**What to build:** Let verified customers recover purpose-limited continuation while keeping anonymous booking complete and keeping Customer identity separate from Merchant authority and historical Customer Details.

**Blocked by:** Deliver Merchant, Brand, Shop, and Catalog Selection; Deliver Provider-Free Confirmation and Protected Access.

- [ ] Anonymous and verified customers can reach equivalent Booking outcomes.
- [ ] Customer Account association never rewrites snapshotted Customer Details or grants cross-merchant data access.
- [ ] Verified continuation can recover eligible confirmation access without replacing purpose-limited capability checks.
- [ ] Optional Google and Apple identity providers expose disabled, needs-configuration, error, and success states without blocking anonymous booking.
- [ ] Provider passcode proof is short lived and bound to one Booking Session and Provider; it is neither Customer identity nor Merchant authorization.
- [ ] Account linking, ownership lookup, merchant isolation, historical immutability, recovery, passcode, and provider scenarios pass.

## Close Visual, Responsive, Motion, Copy, and Accessibility Parity

**What to build:** Replace remaining provisional customer screens with the accepted legacy-observable composition and interaction quality across every delivered journey without importing unauthorized assets or obsolete implementation concepts.

**Blocked by:** Deliver Cancellation and Refund Obligations; Deliver Atomic Rescheduling and Versioned Reminders; Deliver Waiting List Applications and Availability Offers; Deliver Walk-in Enrollment and Queue Lifecycle; Deliver Optional Customer Identity and Verified Continuation.

- [ ] Every ledgered route and state uses the accepted shell, typography, spacing, imagery role, overlay, sheet, processing, announcement, toast, tooltip, review, and feedback composition.
- [ ] Required standalone, embedded, phone, tablet, and desktop profiles preserve scroll ownership, layering, safe areas, focus, pointer, keyboard, zoom, and reduced-motion behavior.
- [ ] English, Spanish, French, and Romanian have equivalent content completeness and layout evidence.
- [ ] Motion and transition timing match the accepted observable checkpoints without making animation a correctness dependency.
- [ ] Every asset is authorized by the provenance policy or replaced by an approved equivalent.
- [ ] Obsolete provisional presentation is removed only after its routes and named scenarios pass.
- [ ] Reviewed visual evidence uses only documented element-scoped tolerances for renderer variation.

## Verify the Full Matrix and Execute Safe Cutover

**What to build:** Prove the complete parity contract under realistic combinations and switch production ingress to the completed Booking experience with a rehearsed, bounded recovery strategy.

**Blocked by:** Productionize the Deterministic Parity Harness; Close Visual, Responsive, Motion, Copy, and Accessibility Parity.

- [ ] The complete journeys × locales × viewports × embeddings × integration-profiles matrix has an implemented, verified, or explicitly waived ledger disposition.
- [ ] Determinism, privacy, cross-merchant isolation, concurrency, idempotency, retry, reconciliation, accessibility, asset provenance, and performance budgets pass in CI evidence.
- [ ] Empty-database and current-schema migration rehearsals complete through expand, backfill, verify, and contract phases.
- [ ] Operational documentation covers provider configuration, queue recovery, notification and payment reconciliation, evidence review, and incident diagnosis.
- [ ] Deployment is additive and rehearses Public Site ingress cutover without dual writes, legacy payload translation, or production customer-data migration.
- [ ] Rollback is limited to compatible build and ingress reversal before contract cleanup; after schema expansion, recovery favors forward repair.
- [ ] Obsolete routes and implementation paths are removed only after acceptance criteria, production signals, and rollback gates are satisfied.
