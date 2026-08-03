# Expand D1 for beesolo

Type: task
Status: resolved
Blocked by: 23

## Question

Add the forward-only, additive D1 foundations required by the remaining Solo subscription, scheduling, Customer Directory, Appointment operations and series, Walk-in Queue, Waiting List, notification, reporting, privacy, and audit behavior while old and new application versions remain compatible. Prove empty-database creation, upgrade from the immediately supported production schema, no-change preflight failure, bounded resumable backfills, Solo invariant enforcement, pre/post evidence, and reviewed forward compensation without switching writers, contracting old schema, or representing incomplete backfills as ready.

## Acceptance criteria

- [x] Every new durable fact has an owner, invariant, retention boundary, compatibility window, and migration or backfill strategy.
- [x] Empty and supported-upgrade real-D1 tests pass with production-shaped fixtures and explicit pre/post counts.
- [x] Failed preflight leaves all rows unchanged; interrupted backfills resume idempotently and keep candidate and previous Workers compatible.
- [x] Schema rollback is not required or promised; every failure has a reviewed forward-repair or traffic-rollback path.

## Comments

### Resolution — 2026-08-02

Added the forward-only `20260802120000_beesolo_expand` D1 migration and matching Drizzle schema. The expand phase introduces dormant companion foundations for migration jobs and evidence, the authoritative Solo Merchant Subscription projection, schedule exceptions and exact blocked time, Merchant-scoped Customer Records and Contacts, Appointment origin/customer/series linkage, finite Appointment Series, append-only External Collections, Privacy Requests and revision-bound preflights, the restore-external Privacy Action Ledger, and expiring Report Export metadata. Existing tables and writers remain intact; no capability switches writers and no old schema is contracted.

The exported `beesoloDurableFactPolicies` registry records an owner, invariant, retention boundary, candidate/previous-Worker compatibility window, population strategy, and reviewed forward repair or traffic-rollback path for every new durable fact family. Schema rollback is neither implemented nor promised.

The migration performs its Solo graph preflight before creating product foundations, aborts incompatible rows without changing domain data, and installs database guards preventing a second or non-active/default Provider while automatically preserving sole-Provider Service eligibility for subsequent old-Worker Service inserts.

`backfillAppointmentFoundations` processes at most 100 rows by default (hard-capped at 500), atomically commits companion rows with its durable job cursor/count and pre/post batch evidence, and resumes by finding still-missing rows rather than trusting lexical cursor order. This makes replay idempotent and catches an Appointment created by a previous Worker behind the recorded cursor during the compatibility window. A job is not `complete` while a known source row lacks its foundation.

Verification passed on real local D1: empty-database creation; production-shaped upgrade with explicit Merchant, Provider, Appointment, and foundation pre/post counts; incompatible preflight with unchanged rows and no product table creation; interrupted 2/2/1-row backfill, duplicate resume, late old-Worker insert, and Solo Provider enforcement. The full database package passed 13 test files and 28 tests, package TypeScript passed, and scoped `git diff --check` passed.

### Reopened after review — 2026-08-03

The second Standards and Spec review found the original resolution incomplete. Repair work must address restore-external Privacy Action Ledger authority, concurrency-safe truthful backfill completion and counts, durable preflight/before/after evidence, cross-Merchant relational enforcement, complete Appointment Series cadence and membership invariants, production-shaped Owner/Shop/Service fixtures, Drizzle-to-migration constraint parity, Effect v4 typed backfill behavior, and the map's execution-note inconsistency before this issue can resolve again.

### Repair resolution — 2026-08-03

The reopened findings are repaired. The Privacy Action Ledger now has its own migration stream and D1 binding outside Merchant-data restores. The primary migration's first statement rejects incompatible Solo graphs without changing rows or schema, including Owner-Provider, sole-Shop, Brand/Shop tenant, and active Service-eligibility violations. Prospective triggers preserve those invariants after upgrade.

Appointment Series cadence and membership are constrained and immutable, with composite Merchant ownership for companion facts. The previous-Worker Appointment trigger creates the matching foundation and reconciles the durable job from committed source/foundation counts; it leaves partial work `running` and records repair evidence. The backfill is exposed through an Effect v4 service with schema-decoded input and typed failures.

Real-D1 coverage now includes empty creation, production-shaped supported upgrade with explicit Owner/Shop/Service/eligibility/Booking Session/Appointment/snapshot counts, exact no-change preflight failure, cross-Merchant rejection, Series mutation rejection, interrupted and concurrent backfills, old-Worker inserts during and after backfill, and the separate restore-external ledger. Final Standards and Spec reviews both passed with no findings. Verification passed: 13 DB test files and 36 tests, DB TypeScript, the infrastructure restore-boundary test, and scoped `git diff --check`. Repository-wide typechecking reaches the DB package successfully but remains blocked by an unrelated concurrent booking fixture error concerning `occupiedStartsAt`.

### Reopened after final review — 2026-08-03

A final independent review found remaining External Collection append-only/attribution gaps, a composite Customer unlink action that attempted to null Merchant ownership, an unused runtime input Schema, canonical product-name and deployment-documentation drift, and duplicated reconciliation queries. These findings are being repaired before the issue returns to resolved.

### Final-review resolution — 2026-08-03

All final-review findings are repaired. External Collections now persist actor, optional note/reference, and Merchant/Appointment-scoped correction evidence; database triggers reject update and delete. Customer Record deletion explicitly unlinks Appointment foundations before the composite restrictive foreign key is evaluated, preserving non-null Merchant ownership. Backfill inputs are decoded from `unknown` through the Effect Schema and decoding failures use the canonical `BeesoloBackfillInputInvalid` typed error. Reconciliation counts are computed once, Drizzle's migration-job default matches D1, canonical product spelling is restored, and `ARCHITECTURE.md` documents and diagrams the restore-external Privacy Action Ledger D1.

Final Standards and Spec reviews both passed with no findings. Verification passed: the focused real-D1 suite passed 14 tests; the complete DB suite passed 14 files and 39 tests; DB TypeScript, formatting, scoped diff validation, and the infrastructure restore-boundary test passed. Repository-wide typechecking passed the issue-24 scope and stopped only on an unrelated concurrent `packages/capabilities/src/subscriptions/stripe-billing.test.ts:208` fixture type error.

### Reopened for exhaustive final review — 2026-08-03

The next fresh review found that External Collection rows were append-only but did not yet enforce cumulative net bounds against the Appointment Price Snapshot or require a correction to be one exact, unique offset of its referenced entry. It also found that the architecture diagram did not visually connect Operations to the restore-external ledger. The issue remains claimed until repeated Standards and Spec reviews both pass with no findings.

### Exhaustive final-review resolution — 2026-08-03

The repeated review loop is complete. External Collections now require an integer-minor Appointment total, matching currency, cumulative net between zero and that total, and one exact unique offset for each correction. Null, missing, malformed, fractional, cross-currency, under-net, and over-net snapshot states are rejected while audited privacy erasure and explicit revisioned rescheduling remain possible when the replacement still preserves collection truth.

The final pass also closes the remaining structural edges: semantic UTC input decoding, exact `HH:MM` Appointment Series cadence, immutable Series and Appointment Foundation identity, cascade-safe Appointment deletion with truthful job reconciliation, Provider-last Service eligibility, corrupted legacy tenant-eligibility preflight, revision-bound immutable Privacy Request Preflights with automatic invalidation, and the restore-external Privacy Action Ledger architecture connection. Existing Solo-plan, one-membership, and cascade-safe Owner deletion protections are covered by real-D1 regression assertions.

Verification passed on the finished state: the focused real-D1 expand suite passed 16/16 tests; DB TypeScript and scoped formatting passed; the restore-boundary infrastructure test, isolated foundation migration test, and subscription-retention live test passed. The serial DB run passed 13 files and 38 tests before one Miniflare `EADDRNOTAVAIL` transport failure; that affected foundation test passed immediately in isolation. The final fresh Standards and Spec reviews both returned PASS with no findings.
