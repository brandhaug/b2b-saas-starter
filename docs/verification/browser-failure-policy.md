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
