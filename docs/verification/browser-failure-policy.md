# Browser failure evidence and process ownership

Run from the repository root after installing dependencies and Chromium:

```sh
node apps/web/test/browser-policy/verify.mjs
```

The verifier imports the production Playwright configuration and substitutes a
small HTTP server and one intentional assertion failure. It runs once with the
configured retry policy, once with an explicit diagnostic retry, and once with
SIGTERM after the browser confirms the server is ready. It checks
the runner's JSON report, original trace attachment, exit status and server PID.
A separate HTTP server must remain reachable after each run.

Observed on 2026-11-05:

- Original run exited 1 with one failed attempt and a retained trace.
- Diagnostic retry passed its second attempt, but the runner still exited 1 and
  classified the result as flaky.
- Cancellation interrupted the running test and stopped its owned server.
- All runs stopped their owned server; the unrelated server remained reachable.

Results, traces and logs are saved under `.context/browser-policy/original` and
`.context/browser-policy/diagnostic-retry`, and `.context/browser-policy/cancelled`.
The verifier succeeds only when all
expected-failure runs satisfy these checks. It does not exercise application
authentication, D1 or business behavior; the normal E2E suite owns that coverage.

CI loads the Playwright CLI in-process through `scripts/playwright.mjs`. The
adapter translates SIGTERM into Playwright's SIGINT cleanup path. The former
synchronous E2E wrapper and its retry test are
removed. Their meaningful invocation-count and preserved-evidence assertions now
belong to this real-browser verifier. Shard arguments go directly to Playwright;
there is no argument-forwarding wrapper or executable-name cleanup to test.

## Conversation hydration regression

The first CI Alchemy run after disabling retries failed when a second conversation
tab asserted live connection before client hydration. Its original trace and
error snapshot showed the language combobox disabled and saved history loading.
The first visit already waited for the shell's enabled language control, but the
second tab and later full navigations did not. The conversation test now applies
that same observable readiness check before each connected-state assertion.
The existing five-second assertion deadline and runner deadline are unchanged.

Reproduce against Alchemy with:

```sh
CI=1 E2E_PORT=3097 DEV_API_PORT=8797 DEV_BACKGROUND_PORT=8798 E2E_SERVER=dev \
  pnpm -C apps/web test:e2e e2e/assistant-conversations.spec.ts --workers=1
```

Observed after the repair: three tests passed, including authentication setup,
the cross-tab/back/forward conversation scenario, and authentication cleanup.
The original CI artifact is `alchemy-local-1` in Actions run `42005975297`;
failure traces diagnose the first attempt instead of relying on a retry to pass.
