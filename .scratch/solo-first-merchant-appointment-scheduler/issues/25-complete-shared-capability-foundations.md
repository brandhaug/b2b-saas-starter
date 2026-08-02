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
