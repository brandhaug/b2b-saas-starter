# Establish the beesolo Release Baseline

Type: task
Status: resolved
Blocked by:

## Question

Establish the independently verifiable baseline for all later implementation: migrate active product identity and generated evidence toward lowercase beesolo without destructively recreating persisted or deployed resources; inventory every Production Ingress and its owning contract; make Solo-only absence guards cover plans, Members, Providers, selection, navigation, fixtures, documentation, and parity states; bind deterministic production-shaped fixtures to the existing booking invariants; and make the parity ledger and release-candidate identity fail on unowned, planned, placeholder, skipped, starter, Platform API, or deferred Team launch behavior.

## Acceptance criteria

- [x] One generated inventory names every external route, callback, Queue consumer, and scheduled trigger with its owning surface and verification seam.
- [x] Automated guards reject active starter identity, prohibited Team behavior, Provider choice, Platform API promises, and unsupported launch states while documenting intentionally retained historical compatibility facts.
- [x] Deterministic fixtures preserve Merchant isolation, sole Owner-Provider binding, conflict-safe holds, immutable Appointment snapshots, transactional outbox behavior, and network-fresh production reads.
- [x] A candidate manifest binds the commit, build artifacts, parity revision, schema baseline, and configuration shape used by later release evidence.

## Comments

### Resolution — 2026-08-03

Closed again after correcting every finding from the reopened two-axis review. The generated inventory now includes the Stripe Subscription and typed Transactional Email callbacks, treats appointment payment as deferred launch ingress, renders pipe-containing methods safely, and binds API Worker configuration into candidate identity. Candidate policy uses explicit ingress dispositions, fails on unassigned parity inventory, and scans active Public, Merchant, Booking, public-content, and current operational documentation for starter identity, Platform API promises, Team/Member behavior, Provider navigation, and Provider choice while excluding historical ADR, research, generated, and agent records.

The deterministic fixture assertion now lives in Merchant Catalog and runs during seed and candidate creation. It enforces the Solo Plan, one active default Owner-Provider, Merchant boundaries, and explicit active-Service eligibility. Scheduling and Booking assertions remain in their owning contexts; the executable evidence suite feeds the canonical fixture through hold, immutable snapshot, transactional outbox, network-fresh HTTP, and Public Site dispatch seams while retaining the live Booking suites.

Verification passed after the final correction pass: the executable release baseline now runs 91 tests across canonical fixture, live Booking, HTTP, Public Site dispatch, Customer association, and typed API callback seams. All 25 monorepo typecheck tasks pass. The candidate command deliberately exits `1` on current planned parity, deferred payment and Platform API ingress, active starter identity, public Platform API documentation, Team behavior in application or core business code, Provider navigation, and Provider-choice code. Customer Directory convergence updates only its association field; Booking owns initialization of immutable origin and customer-note facts. The full monorepo test run is otherwise green but remains blocked by the concurrently implemented Background operational-messaging fixture violating the database one-Owner-Provider trigger; that unrelated fixture is outside this ticket.

### Reopened — 2026-08-03

Reopened after the two-axis review found incomplete callback inventory, malformed generated Markdown, inert Solo and active-identity guards in the real candidate command, missing unowned-ledger detection, partial fixture binding, incomplete API configuration identity, and incorrect launch-optional classification of the out-of-scope appointment-payment callback. The fixture validator also belongs in Merchant Catalog rather than release tooling.

### Resolution — 2026-08-02

Established an executable beesolo release baseline without renaming or recreating persisted Cloudflare resources. The active root package identity is now lowercase `beesolo`; the existing `b2b-saas-starter` D1, Worker, Queue, and workspace-package identifiers are explicitly retained as historical compatibility facts until a separately evidenced forward-only cutover.

[beesolo Production Ingress Inventory](../../../docs/generated/beesolo-production-ingress.md) is generated from one typed inventory and covers the Public Site, Booking dispatcher and service-bound Booking App, Merchant App, Operations App, payment callback, Meta and SMSO callbacks, the Booking Events Queue consumer, and the five-minute recovery trigger. Every entry names its owning surface, contract, and verification seam. The still-deployed Platform API route family is inventoried as deferred compatibility ingress and therefore blocks a beesolo candidate rather than becoming an accidental launch promise.

The release baseline now provides:

- `bun run release:baseline`, which deterministically regenerates the ingress evidence;
- `bun run release:candidate <artifact...>`, which fails closed on planned or waived parity, missing ownership, placeholder/skipped/starter evidence, deferred Solo behavior, Platform API ingress, missing build artifacts, and then binds commit, artifact digests, parity-source digest, latest schema migration, and configuration-shape digest in a versioned manifest;
- a seed-time invariant assertion that binds the canonical deterministic fixture to the Solo plan, exactly one active Owner-linked Provider, Merchant isolation, sole-Provider eligibility and Appointments, and non-overlapping Appointment facts; the existing live Booking Confirmation and HTTP suites remain the verification seams for conflict-safe holds, immutable snapshots, transactional outbox atomicity, and network-fresh/no-store reads;
- focused automated tests proving inventory completeness, fail-closed candidate behavior, and rejection of a second Provider.

Verification passed: 11 focused tests, all 25 monorepo typecheck tasks across 17 packages, scoped formatting, and `git diff --check`. A deliberate candidate-gate run exited `1` on the current planned parity ledger and deferred Platform API ingress, proving later tickets cannot promote incomplete evidence. The generated candidate remains intentionally unavailable until the downstream implementation, public-product, hardening, and contraction tickets resolve those blockers.
