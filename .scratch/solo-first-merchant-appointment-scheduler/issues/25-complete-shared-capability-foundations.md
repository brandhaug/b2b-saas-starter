# Complete Shared Capability Foundations

Type: task
Status: resolved
Blocked by: 24

## Question

Complete the shared Effect v4 and Live D1 application seams needed by every later vertical slice: authenticated Owner and attributed impersonation authority, same-shape cross-Merchant not-found behavior, Merchant Access Hold and Restricted Access policy, typed errors, idempotency, optimistic revisions, immutable history, minimized audit, atomic domain-plus-outbox writes, PII-free Queue wake-ups, claim recovery, deterministic clocks, and contract tests shared by Live D1 and test adapters. Make denied mutations prove zero domain, notification, financial, and success-audit consequences.

## Acceptance criteria

- [x] Capabilities, rather than routes or components, own authorization, validation, revisions, idempotency, history, audit, and transactional consequences.
- [x] A generated authorization and Merchant-isolation matrix covers reads, mutations, searches, exports, callbacks, queued actions, Owner sessions, access holds, Restricted Access, and impersonation.
- [x] Real-D1 tests cover same-key replay, changed-payload rejection, stale revisions, competing transactions, commit-before-enqueue, redelivery, and overlapping recovery sweeps.
- [x] Runtime applications select Live D1 and expose typed unavailable states instead of production fixture fallback.

## Comments

### Final isolation follow-up — 2026-08-03

Closed the final cross-Merchant isolation gaps. Existing-resource commands now return
the same `CapabilityNotFound` result whether the aggregate is unknown or belongs to a
different Merchant, using only the requesting Merchant's scoped lookup. Outbox IDs
include Merchant identity, so two Merchants can create the same capability aggregate
and atomically emit independent work without a primary-key collision. Seed and real-D1
contract tests cover both behaviors with outbox delivery enabled.

The follow-up review also hardened the identity formats themselves. Outbox IDs now
encode the full Merchant/capability/aggregate/revision tuple as canonical JSON rather
than delimiter-based concatenation. Command, aggregate, resource, and authority keys
use the same unambiguous tuple strategy. Idempotency records bind a SHA-256 digest of
the canonical structural command plus decoded domain input, keeping payload material
out of persistence. Seed and real-D1 tests reject structural or domain-payload changes
under a reused key and prove adversarial delimiter-shaped identities cannot collide.

Authorization remains ahead of replay-state disclosure: exact and changed cross-
Merchant replays both return the same `CapabilityNotFound`, while authorized
same-Merchant structural changes return the idempotency conflict. Seed authority
fixtures now accept typed reference/authority entries and canonicalize decoded
references internally, including references whose object properties arrive in a
different order.

### Final review remediation — 2026-08-03

Closed the last review findings: subscription lifecycle interpretation now remains in
the Subscriptions context behind a required schema-defined Effect resolver; authority expiry
uses the deterministic command clock; same aggregate IDs are isolated by preferring
the requesting Merchant, allowing independent revision-zero creation, and otherwise
returning same-shape not-found; and the generated
matrix includes Pricing, Payments, Gift Cards, Customer Identity, Customer Engagement,
and Scheduled Work.

The authorization inventory now has an adjacent intent node, and the canonical Drizzle
schema mirrors all migration checks, defaults, foreign keys, unique constraints, and
recovery/authority indexes. Existing Subscription work already covered every safe Appointment action
preserved under Restricted Access. Focused capability, schema, and migration tests pass.

### Resolution follow-up — 2026-08-03

The reopened review findings are resolved. Live authority now comes from persisted
Owner sessions, attributed impersonation sessions, callback correlations, or claimed
work, with fail-closed subscription state and persisted Merchant Access Holds.
Restricted Access exceptions are classified by bounded-context adapters from concrete,
resource-bound commands rather than caller flags.

The foundation now accepts schema-defined mutation requests and generates only typed
Merchant-scoped insert, update, and delete statements. Domain changes, revisions,
idempotency records, immutable history, minimized audit, and outbox work commit in one
D1 batch. PII-free Queue wake-ups are processed through a registered background handler
with due-time checks, exclusive claims, stale recovery, redelivery, and completion.

The generated matrix structurally verifies the exact Merchant capability/operation
inventory and bounded-context exceptions. Seed, real-D1, migration, Queue decoding,
formatting, and lint checks pass; both final Standards and Spec reviews are clean.

### Reopened — 2026-08-03

Reopened after the second Standards and Spec review. The follow-up must replace
caller-asserted authority and access facts with authoritative Live D1 resolution,
include actual domain writes in the same transaction as replay, history, audit, and
outbox consequences, add a real PII-free Queue wake-up boundary, prove denied domain,
notification, financial, and success-audit effects, generate and structurally verify
the complete capability matrix, prevent claims before `availableAt`, and introduce
Effect schemas for the shared application contracts.

### Resolution — 2026-08-02

Added the shared Effect v4 capability foundation and matching deterministic-test and
Live D1 adapters. The capability now owns typed authority and access policy,
same-shape cross-Merchant not-found behavior, idempotent replay, optimistic aggregate
revisions, immutable history, minimized actor and impersonation audit, atomic PII-free
outbox persistence, exclusive claims, stale-claim recovery, and completion.

The authorization and Merchant-isolation matrix is generated from the canonical
operation vocabulary and covers Owner, impersonation, callback correlation, queued
worker authority, Access Hold, Restricted Access, and cross-Merchant behavior. Denied
mutations are tested to leave command, revision, history, audit, and outbox facts
unchanged.

Real-D1 tests prove same-key replay, changed-payload rejection, stale-create rollback,
first-commit-wins contention, durable commit-before-delivery work, PII-free wake-ups,
redelivery, and non-overlapping recovery claims. The service is part of the Live D1
runtime layer; its deterministic adapter remains explicit test infrastructure and
dependency failures map to `CapabilityUnavailable`.

Verification passed with eight focused Seed/Live tests, all 25 workspace typecheck
tasks, formatting, linting, and scoped diff checks. The broader capability run had
421 passing tests; its remaining legacy Live D1 failures are older fixtures that
conflict with issue 24's enforced single active default Owner-Provider invariant and
are not caused by this foundation.
