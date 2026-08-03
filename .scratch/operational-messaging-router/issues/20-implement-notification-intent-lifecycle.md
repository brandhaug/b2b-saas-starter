# Implement the Notification Intent Lifecycle

Type: task
Status: resolved
Blocked by: 18, 19

## Question

Implement the Notifications aggregate and Effect command/query seams for intent preparation, Scheduled/Ready/Routing/Awaiting Provider/Terminal progress, Delivered/Not Sent/Delivery Failed results, ordered WhatsApp-first routes, immutable Submission Attempts and Provider Evidence, bounded transient retries, the exact terminal-failure SMS fallback boundary, Submission Unknown reconciliation-only behavior, supersession, fresh manual-intent idempotency and limits, and at most one Chargeable Delivery. Use exhaustive state-machine, property, concurrency, and failure-boundary tests to prove monotonic projection, semantic deduplication, eligibility rechecks, reservation safety, duplicate and reordered evidence handling, contradictory-evidence quarantine, seven-day ambiguity closure, and independence from the originating Appointment and email/webhook outcomes.

## Comments

### Resolution — 2026-07-29

Implemented and verified the provider-neutral Notification Intent lifecycle in commit
`bf22ee2`.

- Added schema-derived Effect commands and queries for preparation, scheduling,
  routing, provider waiting, immutable terminal results, ordered WhatsApp/SMS routes,
  bounded retries, exact fallback boundaries, supersession, ambiguity closure, and
  fresh manual intents.
- Added protected recipient snapshots, immutable Submission Attempts, normalized
  append-only Submission Outcomes and Provider Evidence, provider-scoped response
  identity, duplicate/reordered evidence projection, and contradiction quarantine.
- Added D1-backed semantic deduplication, environment-scoped eligibility rechecks,
  Merchant-control and suppression refresh, cross-isolate leased mutations with
  token-fenced writes, and monotonic recovery from reordered callbacks.
- Integrated the existing Messaging Finance authority with one shared reservation,
  recoverable conversion/release ordering, and at most one durable Chargeable
  Delivery and Merchant charge.
- Wired Seed and Live capability layers and added the lifecycle leaf intent node.

Verification passed: Capabilities `65` files / `374` tests with coverage above all
thresholds, Database `7` files / `14` tests, package type-checking, scoped linting,
formatting, and both Standards and Spec review with no remaining high/medium or
P1/P2 findings. Full-monorepo type-checking still reaches an unrelated pre-existing
`packages/auth/src/operations.integration.test.ts` role-map mismatch for
`messaging-finance`; the owning Capabilities and Database packages pass.
