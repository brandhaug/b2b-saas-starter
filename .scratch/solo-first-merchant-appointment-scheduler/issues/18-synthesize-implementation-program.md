# Synthesize the Implementation Program

Type: task
Status: resolved
Blocked by: 17

## Question

After the preceding decisions resolve, what dependency-ordered tracer-bullet implementation tickets will launch beesolo across D1 migrations, Effect capabilities, Merchant App, Booking App, Background Worker, Solo subscription billing, email/SMS providers, tests, operations, documentation, rollout, and rollback while keeping each slice independently demonstrable, preserving the existing booking invariants, and excluding every deferred Team capability?

## Comments

### Resolution — 2026-08-02

The implementation program now contains eighteen dependency-ordered tracer-bullet tickets derived from the complete decision record and the canonical PRD. Each ticket owns an independently demonstrable path through its required D1, Effect capability, Worker, application, provider boundary, and focused verification rather than deferring integration into horizontal schema, UI, or test phases.

The route is:

1. [Establish the beesolo Release Baseline](./23-establish-beesolo-release-baseline.md) is the sole initial frontier. It fixes candidate identity, Production Ingress ownership, deterministic booking invariants, parity ownership, and automated absence guards for starter, Platform API, and Team launch behavior.
2. [Expand D1 for beesolo](./24-expand-d1-for-beesolo.md) adds compatible forward-only durable foundations, preflight evidence, and resumable backfills without switching writers or contracting schema.
3. [Complete Shared Capability Foundations](./25-complete-shared-capability-foundations.md) establishes the common Effect and Live D1 authority, isolation, idempotency, revision, history, audit, outbox, Queue, and recovery seams used by every product slice.
4. Three branches then become independently takeable: [Establish Transactional Email Readiness](./26-establish-transactional-email-readiness.md), [Deliver the Solo Subscription Lifecycle](./27-deliver-solo-subscription-lifecycle.md), and [Deliver Customer Directory Foundations](./28-deliver-customer-directory-foundations.md). This deliberately places required email readiness before first activation and Customer Record authority before booking confirmation.
5. [Deliver Merchant Activation and Publication](./29-deliver-merchant-activation-and-publication.md) joins email readiness and Solo entitlement into the complete one-Shop configuration, Availability, Preview, Launch Test, and publication journey.
6. [Complete Public Guest Booking and Confirmation](./30-complete-public-guest-booking.md) joins publication with Customer Directory authority to complete conflict-safe guest booking, protected Confirmation operations, and `.ics` export. [Deliver Merchant Appointment Operations and Series](./31-deliver-merchant-appointment-operations.md) independently joins the same foundations for the responsive ledger, explicit Owner commands, External Collections, and finite series.
7. [Complete Transactional Email Workflows](./32-complete-transactional-email-workflows.md) extends the readiness seam across public and Merchant Appointment events, reminders, durable evidence, retries, dead letters, and scheduled recovery.
8. [Integrate Appointment Operational Messaging](./33-integrate-operational-messaging.md) composes the scheduler with the separately authoritative Operational Messaging Router without duplicating its routing, Messaging Balance, Rate Card, providers, reconciliation, or Feature Activation Gate. Core remains releasable with truthful disabled mobile states.
9. [Deliver the Walk-in Queue Operating Loop](./34-deliver-walk-in-queue.md) and [Deliver the Waiting List Operating Loop](./35-deliver-waiting-list.md) branch in parallel from Customer, Availability, and required-email foundations.
10. [Deliver Merchant Reporting and Exports](./36-deliver-reporting-and-exports.md) joins the complete operational fact set into truthful Shop-local reports, drill-downs, privacy-minimal artifacts, retention, and explicit result states.
11. [Deliver Privacy Request Operations](./37-deliver-privacy-request-operations.md) builds accountless intake, Operations review, Access, Correction, Erasure, holds, minimized audit, and restore-safe replay on Customer and notification foundations.
12. [Publish the beesolo Public Product](./38-publish-beesolo-public-product.md) joins canonical identity, publication, and privacy intake into the bilingual product, Help, Blog, legal, metadata, indexing, retired-route, and branding-cutover contract.
13. [Harden Production and Prove Release Readiness](./39-harden-production-and-prove-readiness.md) binds the complete functional candidate to the Core evidence matrix, accessibility, security, load and fault injection, dashboards, alerts, runbooks, migration, rollback, restore, parity, legal, and immutable Release Readiness Record.
14. [Contract Compatibility Scaffolding and Release beesolo](./40-contract-and-release-beesolo.md) is the sole terminal ticket. It contracts prior forms only after compatibility evidence, performs forward-only production cutover, and promotes Core independently from optional provider activation.

All local blocker references resolve, the graph is acyclic, and the sole initial implementation frontier is [Establish the beesolo Release Baseline](./23-establish-beesolo-release-baseline.md). The program preserves D1 authority, Effect v4 application seams, capability-protected Booking Sessions and Confirmations, conflict-safe holds, immutable Appointment snapshots, idempotency, optimistic concurrency, transactional outbox recovery, Merchant isolation, and the network-fresh PWA boundary. It creates no Team Plan, additional Member or Provider, invitation, role, seat, Provider-selection, Platform API, external-calendar synchronization, or other deferred launch behavior.
