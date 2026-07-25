# Synthesize the Full-Parity Implementation Plan

Type: task
Status: resolved
Blocked by: 06, 07, 08, 09, 10, 11, 13, 14

## Question

How should the resolved parity contract be decomposed into dependency-ordered, independently verifiable implementation slices that evolve the existing Booking App, capabilities, APIs, database, packages, fixtures, and tests to full parity without a high-risk wholesale rewrite?

## Answer

The dependency-ordered delivery plan is recorded in [Full-Parity Booking App Implementation Plan](../full-parity-implementation-plan.md).

The rebuild proceeds through 16 tracer slices rather than horizontal layers or a replacement application. It begins by freezing a machine-readable parity ledger, then allows deterministic parity infrastructure, capability/persistence foundations, and StyleX/localization/asset foundations to advance in parallel. The canonical shell and session boundary reunite those tracks before customer journeys deepen incrementally through scheduling and group requests; pricing and checkout; provider-free confirmation; payments and gift cards; cancellation and rescheduling; waiting lists; walk-ins; and optional customer identity.

Every journey slice crosses the domain, D1, Effect capability, Booking transport, deterministic fixture, localized UI, and verification boundaries needed to leave a runnable, independently evidenced increment. The existing Pay In Person appointment path remains green throughout. Additive expand/backfill/verify/contract migrations, explicit capability subpaths, provider-safe defaults, four-locale completeness, asset provenance, and per-slice scenario evidence prevent a late big-bang integration phase.

Customer-visible visual and state closure follows the functional journeys against the reproducible legacy authority, then the complete parity matrix hardens determinism, privacy, concurrency, retries, migrations, optional-provider behavior, and operations. The final slice specifies additive deployment, Public Site ingress cutover, a bounded build-level rollback, and roll-forward criteria. It explicitly rejects dual writes, legacy route or payload translation, destructive rollback, and production customer-data migration.

No new workspace package is planned, and no new Wayfinder ticket is required. Implementation work should be published later as one epic per slice with smaller tracer-bullet issues only where a slice exceeds one implementation session.
