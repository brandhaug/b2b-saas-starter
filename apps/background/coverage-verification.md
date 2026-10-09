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

The isolated run passes both real-worker suites. These counts come from its JSON
summary, so Node tests cannot account for the measured consumer coverage:

| Source                    | Lines | Statements | Functions | Branches |
| ------------------------- | ----- | ---------- | --------- | -------- |
| `src/webhook-consumer.ts` | 66/81 | 66/81      | 11/12     | 19/28    |
| `src/export-consumer.ts`  | 19/23 | 19/23      | 5/5       | 5/8      |
| `src/queue-consumer.ts`   | 18/31 | 18/32      | 9/12      | 6/14     |

The denominator includes all background TypeScript sources, including unexecuted
code, but excludes tests, declarations and the `test-pool.ts` helper.

## Integrated verification

- `pnpm -C apps/background test`: 18 files and 134 tests pass. Combined coverage
  is 434/556 lines, 440/564 statements, 94/124 functions and 200/260 branches.
- `E2E_PORT=3297 pnpm run validate` on base `8098543b`: exits successfully.
  Browser results record 62 passes, zero retries, failures or skips. See
  `apps/web/playwright-report/results.json`. An earlier run had a retry-pass in
  the Norwegian mobile-menu width assertion; an intervening `pnpm run check`
  hit 5-second timeouts in the existing webhooks-panel and OAuth query tests.
  The final full validation passes all of them without test changes.
- Cache restoration: after a successful run, move `coverage-summary.json` and
  `index.html` out of `apps/background/coverage`, rerun the package test, then run
  `vp run --last-details`. Observed one cache hit and byte-identical restored
  files. Removing the entire coverage directory instead causes a cache miss and
  successful regeneration.
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
