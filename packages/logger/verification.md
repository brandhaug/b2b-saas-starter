# Logging verification

Verified on 2026-11-03 against the logging remediation implementation.

## Regression checks

```sh
pnpm -C packages/logger test
pnpm -C apps/api exec vp test run src/http-logging.test.ts src/mcp-write-authority.test.ts
pnpm -C apps/web exec vp test run src/lib/observability.test.ts src/lib/capabilities.test.ts
VITEST_MAX_WORKERS=1 pnpm -C packages/capabilities test
```

These runs passed. They exercise real console/OTLP serialization, request-to-response logging, nested web context, and protocol failure translation. Defects retain safe name/location summaries without their messages. Returned HTTP 503 and MCP defects carried by HTTP 200 emit error events; ordinary HTTP 4xx responses remain informational. Nested workspace facts survive separately in console and OTLP. The shared capabilities coverage run includes the logger's owned boundary tests; coverage thresholds are unchanged.

## Browser verification

Run sequentially from the repository root:

```sh
pnpm run build
pnpm run db:migrate:local
pnpm run db:seed
CI=1 E2E_PORT=3697 pnpm run test:e2e
CI=1 E2E_PORT=3697 DEV_API_PORT=8897 DEV_BACKGROUND_PORT=8898 pnpm run test:e2e:alchemy
```

Observed: build, migrations and seed passed. Compiled-preview E2E reported 91 passed and 11 skipped. Alchemy E2E reported 17 passed. Playwright writes its repeatable report to `apps/web/playwright-report`; the later run replaces the earlier report.

## Full validation limitation

`VITEST_MAX_WORKERS=1 E2E_PORT=3697 DEV_API_PORT=8897 DEV_BACKGROUND_PORT=8898 pnpm run validate` stopped in `check` because the existing `packages/auth/src/live-totp-replay.test.ts` exceeded its five-second timeout during concurrent package execution. All 103 auth tests passed when the package ran separately. Static checks, script tests, serial package tests, and the remaining validation steps above passed separately. This is not a claim that the aggregate validation command passed.
