# Retention

## Purpose & Scope

Deployment-wide housekeeping under [the retention policy](../../../../docs/retention.md).
The capability owns eligibility and bounded progress. Workers and operator commands
call the same implementation; they do not carry their own cleanup SQL.

## Patterns & Pitfalls

- `retention.ts` defines the service contract and result schemas;
  `retention-policy.ts` owns defaults, validation, approval, and environment
  decoding; `retention.seed.ts` and `retention.live.ts` provide the adapters.

- Approval binds the policy version, durations, budget and database target. Any
  eligibility change must invalidate old approval by changing the policy version.
- Every rule's clock expression must match its database index. Scan protected
  rows too and advance past them; filtering before the page limit can scan an
  unbounded history or starve eligible rows.
- Recheck eligibility in the mutation. Commit its cursor in the same D1 batch.
  A cursor is progress, never authorization to delete a previously selected row.
- Preview is read-only. Its counts cover a bounded page and may be lower bounds.
  An unavailable query must never appear as successful zero work.
- Auth dates are epoch seconds. Invitation terminal timestamps come from database
  triggers because plugin transitions must keep ownership of the mutation.
- OAuth refresh families and independent recovery evidence are outside generic
  cleanup. Sessions referenced by OAuth evidence must also survive.
- Provider-free Seed maintenance reports inactive, pinned by `retention.seed.test.ts`.
  Keep user-visible credential and download expiry equivalent in the owning Seed and
  Live capabilities.
- `retention.live.test.ts` provisions through `withRawTestD1`, not `TestDatabase`:
  retention counts every table, so the shared fixture rows would be candidates it
  never planted.
