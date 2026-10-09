# Background V8 coverage verification

Verified on 2026-10-09 with `@cloudflare/vitest-plugin` 1.4.0 and Vitest/V8
coverage 5.0.1. Coverage is report-only. Node tests and real-worker tests retain
separate projects and Vite servers.

## Reproduce

From the repository root:

```sh
vp install --frozen-lockfile
pnpm -C packages/i18n generate
pnpm -C apps/background test
# Isolate workerd evidence from the Node suites:
pnpm -C apps/background exec vp test run --coverage --project background-pool --coverage.reportsDirectory=coverage/pool-only
```

The standard run writes `apps/background/coverage/coverage-summary.json` and
`index.html`. The isolated run writes the same formats under `coverage/pool-only`.
Run the isolated command last because the standard run cleans the coverage directory.
CI uploads the standard report as `background-coverage-<attempt>` for 14 days.
The cached task restores coverage outputs and excludes them from its inputs.

## Observed workerd coverage

### Failure inventory before adding regressions

Inspected the worker pool suites, Node consumer tests, retention D1 tests,
billing synchronization D1 tests and assistant lifecycle/admission contracts.
The follow-up targets worker wiring and persisted outcomes:

- Shared queue boundary: malformed bodies must ack without trusted-row writes;
  a failing message must not prevent another message in the batch from settling.
- Webhooks: failed attempt persistence must retry; a failed DLQ terminal write
  must retry on delivery one and ack on delivery two. Recovery must commit the
  attempt and audit together and avoid duplicate notifications on redelivery.
- Exports: unavailable work retries before delivery four, then records a failed
  row rather than losing the job with no dead-letter queue.
- Retention: missing/stale approval must prevent deletion; a failed cleanup rule
  must reject the cron invocation. Existing capability tests already cover
  eligibility, cursor atomicity and safe resumption.
- Billing reconciliation: a work-list read failure must reject the minute tick
  without cancelling independent assistant cleanup. Missing provider settings
  must leave Stripe inactive. Capability tests already cover provider drift,
  conflicts, backoff, fairness and recovery.
- Assistant cleanup: host deletion failure must retain the deletion fence while
  expired reservations still release; repeated ticks must not duplicate release
  audits. Directory/lifecycle contracts already cover ownership and tombstones.

Two isolated runs on base `a944d7c0` produced byte-identical JSON summaries.
Two successful post-change runs also produced byte-identical summaries, passing
five real-worker suites and 26 tests. Node tests cannot contribute to these counts:

| Source                          | Base lines | Current lines | Base branches | Current branches |
| ------------------------------- | ---------- | ------------- | ------------- | ---------------- |
| `src/webhook-consumer.ts`       | 66/81      | 73/81         | 19/28         | 23/28            |
| `src/export-consumer.ts`        | 19/23      | 23/23         | 5/8           | 8/8              |
| `src/queue-consumer.ts`         | 18/31      | 24/31         | 6/14          | 9/14             |
| `src/retention.ts`              | 3/40       | 40/40         | 0/18          | 17/18            |
| `src/billing-reconciliation.ts` | 1/18       | 9/18          | 0/8           | 4/8              |
| `src/assistant-cleanup.ts`      | 2/17       | 16/17         | 0/4           | 3/4              |

Workerd totals move from 162/556 to 297/556 lines, 167/564 to 302/564 statements,
46/124 to 84/124 functions, and 42/260 to 99/260 branches.

The denominator includes all background TypeScript sources, including unexecuted
code, but excludes tests, declarations and the `test-pool.ts` helper.

Keep report-only for now. These repeats establish local repeatability, not a
cross-runner CI baseline. The standard report also merges Node and worker coverage,
so its aggregate floor would not protect worker-only failure paths. Collect repeated
isolated CI reports before proposing worker-specific thresholds. Other package
thresholds are unchanged.

### Regression outcomes

- `queue-consumer.pool.test.ts`: every routed queue explicitly acknowledges null,
  scalar and incomplete messages without writing delivery, export, audit or
  notification evidence.
- `webhook-consumer.pool.test.ts`: D1 write failure retries only the affected
  message; a batch sibling completes. A failed DLQ audit rolls back the terminal
  attempt, retries delivery one and acknowledges delivery two. Restored storage
  records one terminal attempt, audit and notification across duplicate redelivery.
- `export-consumer.pool.test.ts`: failed completion retries delivery three, then
  acknowledges delivery four only after persisting terminal failure and its clock.
- `scheduled-failures.pool.test.ts`: preview and stale approval preserve old rows;
  a failed retention rule rejects the cron then succeeds on the next invocation.
  Billing work-list failure rejects the minute tick while reservation cleanup
  completes. Unset Stripe skips that unavailable table. Missing conversation host
  keeps deletion pending across ticks without duplicating reservation-release audits.

Faults use real D1 triggers or a temporarily renamed table, restored by finalizers.
The assistant failure uses an unbound host, not the native transcript host; that
host's deletion and ownership contracts remain covered in its existing suites.

## Integrated verification

- Background package run within validation: 22 files and 150 tests pass, up from
  136 tests. Combined coverage is 514/556 lines, 520/564 statements, 113/124
  functions and 231/260 branches.
- `E2E_PORT=3497 pnpm run validate` on base `a944d7c0` with the added regressions:
  exits successfully, including check, build, generated Wrangler drift detection,
  migrations, seed and browser tests. `apps/web/playwright-report/results.json`
  records 62 passes, zero retries, failures or skips. The first focused test run
  caught a missing `created_at` in the new assistant fixture; the corrected fixture
  passes both repeated worker runs and full validation.
- Independent GPT-6 Astra Standards and Spec reviews of the fixed implementation
  tree found no issues. Production sources, project selection and migration loading
  are unchanged.
- Prior cache verification on base `9ed815a4`: move `coverage-summary.json` and
  `index.html` out of `apps/background/coverage`, rerun the package test, then run
  `vp run --last-details`. Observed one cache hit and byte-identical restored
  files. Removing the entire coverage directory instead caused a cache miss and
  successful regeneration. This follow-up does not change the cache configuration.
- `pnpm audit --audit-level high` remains blocked by the pre-existing, unpatched
  `braces@3.0.3` advisory, GHSA-vfj7-8cjw-p6xm. The audit also reports the existing
  moderate `postcss-selector-parser@6.0.10` advisory, GHSA-rj75-hqrm-r3gf. Neither
  finding is suppressed.

## Upstream support

The [1.4.0 changelog](https://github.com/cloudflare/workers-sdk/blob/%40cloudflare%2Fvitest-plugin%401.4.0/packages/vitest-plugin/CHANGELOG.md)
announces V8 coverage and Vitest 5 support. The
[implementation](https://github.com/cloudflare/workers-sdk/blob/%40cloudflare%2Fvitest-plugin%401.4.0/packages/vitest-plugin/src/pool/index.ts)
enables the local inspector when `coverage.enabled` is true and the provider is
`v8`. Its [coverage tests](https://github.com/cloudflare/workers-sdk/blob/%40cloudflare%2Fvitest-plugin%401.4.0/packages/vitest-plugin/test/coverage.test.ts)
exercise `--coverage`, source inclusion and JSON summaries. No production
compatibility flags are needed.
