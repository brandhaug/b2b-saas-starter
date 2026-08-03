# Legacy Booking App Full Parity

Status: ready-for-agent

## Problem Statement

The current Booking Product proves one provider-free Booking Vertical Slice, but it does not reproduce the Legacy Source's complete customer journey, visual system, route behavior, optional integrations, localization, or operational lifecycle. Customers cannot yet complete composite bookings, paid or gift-card settlement, appointment changes, waiting-list and walk-in journeys, or verified continuation with the breadth and fidelity of the Legacy Source. Merchants also lack the complete Brand and Shop topology, policy, pricing, notification, and lifecycle behavior required to operate those journeys.

Closing this gap as a wholesale port would import obsolete Cart, Sale Order, browser-JWT, dependency, and styling assumptions into the target architecture. It would also risk a late integration failure, non-deterministic parity claims, unsafe data migration, and regressions to the existing Pay In Person appointment path.

## Solution

Evolve the existing server-backed Booking App to full observable parity through dependency-ordered tracer slices. Each slice crosses the required domain, D1, Effect capability, Booking transport, deterministic fixture, localized UI, and verification boundaries while leaving the repository runnable and preserving the existing provider-free appointment journey.

Freeze the accepted parity contract in a machine-readable ledger and verify named deterministic scenarios through the real Booking HTTP/UI journey. Recreate the Legacy Source's customer-observable routes, states, responsive layouts, motion, and integration variants using the target Booking Product's canonical domain model, Cloudflare-first topology, typed Effect services, capability-based access, additive persistence, StyleX presentation architecture, four-locale contract, and provenance-controlled assets. Correct documented legacy defects instead of preserving them, and treat parity evidence as part of every delivered feature.

## User Stories

1. As a customer, I want a merchant-first booking route to resolve the intended Merchant, Brand, and Shop, so that I enter the correct public booking presence.
2. As a customer following an old or malformed link, I want localized recovery that preserves valid intent, so that I am not left on a blank screen.
3. As a customer, I want my Booking Session isolated to one merchant and one browser tab, so that concurrent journeys do not overwrite each other.
4. As a customer, I want my selected locale to persist through booking, continuation, and confirmation, so that the journey remains understandable.
5. As a customer, I want the Booking App in English, Spanish, French, or Romanian, so that I can use a supported language throughout.
6. As a customer, I want dates, times, currency, phone fields, validation, and policy copy localized consistently, so that localized presentation never changes scheduling or monetary facts.
7. As a customer, I want merchant-authored untranslated content to fall back visibly to its source language, so that information is available without pretending it was translated.
8. As a customer, I want to choose a Shop, Provider preference, Service, and Additional Services only when the combination is valid, so that I cannot build an impossible Booking Request.
9. As a customer, I want to select a Specific Provider or Any Provider, so that I can trade preference for availability.
10. As a customer, I want unavailable, empty, loading, invalid, and expired states explained explicitly, so that I always know how to recover.
11. As a customer, I want availability derived from current Schedule Rules and eligibility, so that offered Time Slots are genuinely bookable.
12. As a customer, I want selected Time Slots held while I complete checkout, so that another customer cannot take them unexpectedly.
13. As a customer, I want expired or invalidated holds reconciled clearly, so that stale state is never silently restored.
14. As a coordinator, I want one Booking Party to contain ordered Booking Requests for multiple guests, so that I can arrange a group booking.
15. As a coordinator, I want all group holds acquired atomically, so that a group booking is never partly reserved.
16. As a coordinator, I want to switch between incomplete Booking Requests and return to the earliest incomplete step, so that I can finish the party reliably.
17. As a customer, I want a versioned Pricing Quote bound to my exact selections, holds, policies, promotions, tip, and gift-card reservations, so that the accepted total cannot drift.
18. As a customer, I want discounts, taxes, fees, and tips shown as named Pricing Adjustments, so that the total is understandable.
19. As a customer, I want eligible promotion codes validated by the server, so that limited uses and totals remain trustworthy.
20. As a customer, I want material booking changes to require a new quote and acceptance, so that I never confirm a stale price.
21. As a customer, I want to review and edit all Booking Requests before confirmation, so that mistakes can be corrected without losing the party.
22. As a customer, I want stable localized validation for Customer Details, including E.164-compatible phone handling, so that errors remain useful across locale changes.
23. As a customer, I want to accept the exact Checkout Policy version that applies to my party, so that the agreement is unambiguous.
24. As a person in a Booking Party, I want Marketing Consent captured separately from operational communication, so that booking messages do not depend on marketing permission.
25. As a customer, I want Pay In Person to remain fully usable without optional provider credentials, so that the core appointment journey always works.
26. As a customer, I want confirmation to create every Appointment in my Booking Party or none, so that I never receive a partial result.
27. As a customer retrying after a lost response, I want the identical confirmation command to return the existing result, so that retries cannot duplicate Appointments or charges.
28. As a customer, I want unresolved commitment or settlement shown as Processing, so that partial internal state is never presented as confirmation.
29. As a customer, I want a purpose-limited confirmation link that exchanges its token for protected access and removes the token from the URL, so that appointment details remain private.
30. As a customer, I want neutral recovery for expired, replayed, or cross-merchant confirmation access, so that private resource existence is not leaked.
31. As a customer, I want to pay with supported cards, wallets, Cash App Pay, or BNPL when configured, so that I can choose an available settlement method.
32. As a customer, I want deterministic disabled and needs-configuration states when payment methods are unavailable, so that optional integrations never break checkout.
33. As a payer, I want provider retries and reconciliation to avoid duplicate collection, so that transient failures do not charge me twice.
34. As a gift-card purchaser, I want to buy assigned or unassigned value within merchant rules, so that I can give a valid Gift Card.
35. As a gift-card purchaser, I want exactly one Gift Card issued after successful payment, so that retries cannot duplicate value.
36. As a customer, I want partial or full Gift Card redemption and mixed settlement, so that gift-card value acts as tender rather than a discount.
37. As a customer, I want cancellation eligibility and refund entitlement evaluated separately, so that an appointment can be cancelled even when a refund must be retried.
38. As a customer, I want to cancel one Appointment or explicitly cancel the whole party, so that sibling Appointments are not changed accidentally.
39. As a customer, I want rescheduling to preserve the Scheduled Appointment until a replacement succeeds atomically, so that failed attempts do not lose my booking.
40. As a customer, I want reminders to follow the current Appointment version, so that superseded times do not produce stale notifications.
41. As a customer, I want to join a Waiting List with preferences when no suitable Time Slot exists, so that I can be considered for later availability.
42. As a waiting customer, I want sequential purpose-limited Availability Offers that I can accept, decline, or let expire, so that access is fair and private.
43. As a waiting customer, I want accepting an offer to create a bound Booking Session and Time Slot Hold rather than an Appointment, so that I can still review and confirm.
44. As a walk-in customer, I want to join an available Shop queue with service and Provider preferences, so that my place is based on real merchant configuration.
45. As a walk-in customer, I want duplicate detection, queue position, and wait projections, so that enrollment and expectations are clear.
46. As an anonymous customer, I want every core booking outcome available without creating an account, so that identity providers remain optional.
47. As a verified customer, I want to recover purpose-limited confirmation access, so that account association improves continuation without rewriting historical Customer Details.
48. As a customer selecting a restricted Provider, I want short-lived passcode proof limited to that Booking Session and Provider, so that it cannot become broader identity or merchant authorization.
49. As a merchant, I want configuration to resolve explicitly from Merchant to Brand to Shop and snapshot downstream, so that historical bookings remain stable after catalog changes.
50. As a merchant, I want operational Notification Intents recorded with committed facts and delivered durably, so that provider failures never roll back domain outcomes.
51. As a merchant, I want appointment webhooks to remain signed, thin, at-least-once notifications, so that integrations can reconcile safely without PII in queues or logs.
52. As an integration developer, I want the Platform API to remain a merchant-scoped read-and-notify surface rather than a parallel booking engine, so that first-party invariants have one owner.
53. As a customer using a phone, tablet, desktop, widget, or supported embedded entry point, I want equivalent responsive behavior, so that viewport and embedding do not block the journey.
54. As a keyboard, touch, reduced-motion, or zoom user, I want accessible focus, pointer, overlay, scroll, and motion behavior, so that the full journey remains operable.
55. As a customer, I want the accepted legacy composition, typography, imagery roles, overlays, feedback, and transition choreography, so that the recreated product has observable visual parity.
56. As a maintainer, I want every shipped visual asset to have approved provenance or an authorized replacement, so that parity does not introduce unlicensed legacy binaries.
57. As a maintainer, I want one named deterministic scenario to select every required journey and observable state, so that parity claims are reproducible locally and in CI.
58. As a maintainer, I want optional providers to expose disabled, needs-configuration, success, retryable-failure, and terminal-failure scenarios where applicable, so that integration behavior is testable without production credentials.
59. As a maintainer, I want additive expand, backfill, verify, and contract migrations, so that the Booking Product can evolve without a destructive deployment.
60. As a maintainer, I want the existing Pay In Person appointment smoke journey green after every tracer slice, so that full parity never sacrifices the proven vertical slice.

## Implementation Decisions

- Deliver the work as sixteen dependency-ordered tracer slices, from contract ledger through parity infrastructure, foundations, customer journeys, visual closure, matrix hardening, and cutover. Do not build a parallel replacement application or defer integration to a final merge.
- Begin with a machine-readable parity ledger mapping every inventoried route, journey, state, locale, viewport, integration profile, corrected defect, and source-inferred branch to exactly one owner and named scenario. Each entry is planned, implemented, verified, or explicitly waived.
- Preserve the existing Pay In Person appointment journey throughout. Each slice must leave the repository buildable and independently observable.
- Keep one owner per invariant. Merchant Catalog, Scheduling, Booking, Pricing, Payments, Gift Cards, Waiting List, Walk-ins, Customer Identity, Notifications, and Governance expose transport-neutral Effect services, schemas, typed errors, and results through explicit capability subpaths.
- Booking owns customer-facing routes, HTTP and server-function contracts, redirects, capability cookies, serialization, localization, and response mapping. Applications do not calculate availability, prices, settlement, refunds, queue order, or transactional coordination.
- Retain the Cloudflare Worker topology in which the Public Site delegates booking routes and assets to the Booking Worker, first-party Workers call shared capabilities directly against one D1 database, and the Platform API remains external, versioned, merchant-scoped, and read-and-notify.
- Evolve D1 additively using expand, backfill, verify, and contract migrations. Introduce the richer Brand/Shop topology, Booking Party model, quotes, settlement, payments, gift cards, waiting lists, walk-ins, policy facts, lifecycle history, protected access, Notification Intents, and scheduled work without a destructive application-and-schema switch.
- Use Booking Session as the capability-protected access, locale, expiry, and continuation envelope for exactly one Booking Party. Use Booking Party as the single-currency aggregate containing ordered Booking Requests.
- Acquire every conflict-free Time Slot Hold for a coordinated Booking Party atomically or acquire none. Confirmation atomically creates one Appointment per Booking Request or creates none.
- Bind immutable, versioned Pricing Quotes to exact selections, holds, policy versions, promotions, tips, and gift-card reservations. Material changes require a new version and acceptance.
- Treat Gift Card value as settlement tender, not a Pricing Adjustment. Preserve immutable monetary and ledger facts; make provider interactions and confirmation idempotent and reconcilable.
- Keep cancellation eligibility separate from refund entitlement. Implement rescheduling as an atomic replacement that preserves the original Scheduled Appointment until successful commit.
- Keep anonymous booking complete. Customer Account association and social identity are optional; Provider passcodes create only short-lived, Provider-bound access proof.
- Use merchant-scoped HttpOnly capability cookies, purpose-specific protected-resource access, token-free redirects, neutral failure responses, and server-authoritative version conflict handling. Reject browser JWTs and cross-boundary credential reuse.
- Record semantically deduplicated Notification Intents in the same commit as domain changes. Queue messages, webhook notifications, operational logs, and evidence must not leak Customer Details or bearer secrets.
- Bundle versioned English, Spanish, French, and Romanian catalogs. Land every exposed key and stable error code in all four locales together, and show an explicit fallback indicator for untranslated merchant-authored content.
- Implement a dedicated StyleX Booking theme, typed primitives, controlled premium overrides, named overlay layers, explicit scroll ownership, and focused Framer Motion wrappers. Do not introduce arbitrary component-level styling escape hatches.
- Require provenance before shipping any visual binary. Every asset must be authorized, independently licensed or product-owned, supplied by an enabled provider, or represented by an approved generic fallback.
- Preserve deliberate legacy blank/loading states only where the parity ledger names them as positive assertions. Correct documented unresolved loading, empty professional, and empty service defects with explicit localized recovery.
- Expose deterministic `disabled`, `needs-configuration`, success, retryable-failure, and terminal-failure scenarios for optional providers where applicable. Pay In Person and anonymous booking must work when every optional provider is absent.
- Use additive deployment, Public Site ingress cutover, a bounded build-level rollback, and forward repair after schema expansion. Do not dual-write, translate legacy payloads, perform destructive rollback, or migrate production customer data as part of this effort.
- Do not create a new workspace package unless a second real consumer proves a seam beyond capability or provider ports. Do not revive the Legacy Source package graph or canonicalize Cart, Sale Order, Reservation, or generic Transaction concepts.

## Testing Decisions

- The primary seam is the named deterministic scenario exercised through the real Booking HTTP/UI journey. Each scenario asserts semantic checkpoints and canonical server state, and produces an evidence bundle containing screenshots, DOM/accessibility state, console output, requests, trace/HAR, mutation log, and video where relevant.
- A good parity test proves externally observable behavior or a domain invariant. It does not assert component structure, private Effect implementation, table layout, adapter internals, or incidental CSS values.
- Every ledger entry must have one scenario owner and disposition. Two clean runs of deterministic scenarios must produce identical canonical-state and screenshot hashes except for reviewed, element-scoped renderer tolerances.
- Test-only fixtures use versioned scenario manifests, content-addressed bundles, an injected clock and timezone, isolated run namespaces, atomic reset/snapshot controls, deterministic provider doubles, local assets, and undeclared-network blocking. Runtime applications never fall back to fixture data.
- Use focused capability contract, property, concurrency, transaction, migration, and architecture tests only where the journey seam cannot prove an invariant safely or precisely.
- Capability tests cover hold acquisition, quote binding, promotion and gift-card reservations, confirmation atomicity, idempotency, payment reconciliation, refunds, rescheduling, offer sequencing, queue ordering, notification deduplication, and merchant isolation.
- Migration tests cover both an empty database and upgrade from the current first-slice schema. Architecture tests reject forbidden cross-context imports, root-barrel capability use, application-level table access, and leaked Live adapters.
- HTTP and route tests cover canonical paths, typed query allowlisting, redirects, cookie scope, capability purpose, cross-merchant privacy, multi-tab behavior, version conflicts, token exchange, replay, expiry, and neutral protected-resource recovery.
- UI evidence covers the four locales, required viewport and embedding profiles, direct links, back/forward history, long copy, 200% zoom, keyboard and pointer behavior, focus visibility, reduced motion, overlays, sheets, processing, errors, and responsive composition.
- Integration matrices cover provider absence, disabled and needs-configuration states, deterministic success and failures, duplicate callbacks, provider success followed by local failure, retry/reconciliation, and undeclared network denial.
- Reuse the repository's established Storybook state coverage and focused Playwright approach, while productionizing the Wayfinder parity-harness and StyleX prototypes as the specific prior art for full-parity evidence.
- Each tracer slice adds or updates its scenario manifests, semantic assertions, canonical-state assertions, and operational checkpoints. Visual baselines change only through reviewed evidence bundles.
- The final matrix must prove journeys × locales × viewports × embedding profiles × integration profiles, plus privacy, concurrency, retry, migration, asset-provenance, accessibility, performance-budget, and rollback-readiness requirements.

## Out of Scope

- A wholesale rewrite, parallel replacement Booking App, or revival of the Legacy Source package graph.
- Byte-for-byte copying of legacy binaries, unproven assets, obsolete dependencies, browser JWTs, Cart, Sale Order, generic Reservation, or generic Transaction models.
- Production customer-data migration, dual writes, legacy payload translation, destructive schema rollback, or simultaneous multi-build support after contract migrations.
- Turning the Platform API into a customer booking or checkout engine.
- Making Customer Accounts, social login, payment providers, analytics, error reporting, email delivery, or any other optional provider mandatory for the core journey.
- A generic workspace payment package without a demonstrated second consumer.
- Realtime transport or Durable Objects without a separate coordination requirement.
- Merchant catalog and scheduling writes through the external Platform API.
- Silent preservation of documented legacy defects or unverifiable source-inferred behavior.
- New feature work beyond the accepted parity ledger and the defect corrections explicitly recorded by the Wayfinder session.

## Further Notes

- This spec synthesizes the resolved Wayfinder session in this directory, including its journey, visual, dependency, domain-gap, route/session, integration, localization, StyleX, harness, module-boundary, asset-provenance, domain-model, and implementation-plan artifacts.
- The final implementation plan is the dependency authority for slicing. Its sixteen slices should become implementation epics, with smaller tracer-bullet issues only when a slice cannot fit one implementation session.
- Booking-specific ADRs define the bounded contexts, Worker topology, first-slice D1 baseline, Platform API boundary, and authorization mechanisms. Full-parity implementation deepens or explicitly supersedes first-slice limitations; it must update the affected intent documents and decisions in the same slice.
- Observable parity is judged against the reproducible legacy baseline and accepted corrections, not source-code identity. Exact-pixel checkpoints use reviewed tolerances only for known renderer variation.
- The confirmed highest test seam is the deterministic named-scenario journey boundary; lower seams exist to prove atomicity, privacy, concurrency, and persistence invariants that cannot be observed reliably from a single browser journey.
