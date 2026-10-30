# Native Foldkit migration evaluation

Measured on 2026-10-30 against React baseline
`46de3f85f8e0fea51ff970e95f6d4d811c38a411`.

The web application now uses native Foldkit models, messages, updates, commands,
subscriptions and managed resources. SSR and browser HTTP operations retain the
existing capabilities and authorization boundaries. React email templates remain
in `packages/email`.

## Testability

Pure updates expose state changes and commands without a React renderer or query
provider. Native DOM/runtime tests cover the previously framework-coupled behavior,
including account security, workspace permissions, table history, dialogs and
assistant recovery. Cleanup verification passed 137 files and 926 tests. These
counts describe coverage retained during migration, not a measured reduction in
test-writing time or defect rate.

Browser acceptance remains the integration boundary. The React baseline passed
65 browser tests with 11 optional analytics skips. The first integrated native
validation passed 73 with the same 11 skips. Later visual corrections exposed a
320px demo overflow; responsive button wrapping fixed it and the focused responsive
suite passed. After review repairs and upstream dependency integration, final
`pnpm run validate` passed on the tree committed as `2dad439c`, including 74 browser
tests in 34.7 seconds with 11 optional analytics skips. Independent review results
and their exact revisions belong in the PR.

SSR tests also exercise overlapping request-owned documentation rendering and
failure recovery in workerd. This matters because a passing DOM test cannot prove
Worker compatibility or request-local localization.

## Robustness

The migration preserves server-side gates and independent authorization for HTTP
operations. Effect HttpApi schemas replace the framework's server-function
transport. Browser state cannot authorize mutations. Synthetic demo actions refuse
locally, while live requests retain suspension, CSRF and rate-limit checks.

Verification covered authentication, permission refusals, checkout continuation,
passkeys, personal export, session revocation, audit recovery, URL-backed table
state, overlays and narrow screens. Assistant browser checks cover cross-tab
conversation reopening and recovery when the optional queue is unavailable.
The preview bridge initially loaded the client output as its socket host; using
the explicit server output directory repaired its WebSocket 503 responses.

An exact local Alchemy-injected production build passed. Its compiled Worker
booted in workerd and served public/localized HTML, JSON protocols and asset 404s.
This is local compiled-host evidence, not a deployed smoke test.

Remaining constraints:

- Foldkit SSR is experimental. Exact package pins and compiled-host checks remain
  necessary for upgrades.
- Better Auth's session listing uses an unpaginated adapter read, bounded to 100
  unordered rows in the verified 1.7.13 baseline and retained by the 1.7.14 update. The
  UI merges the authoritative current session, but other-session listing and SDK
  bulk revocation remain bounded.
- Concurrent local browser hosts produced `SQLITE_BUSY_RECOVERY`. The final D1
  verification runs were serialized.
- Three representative final screenshots were inspected. Pixel-identical parity
  across every route is not established. The native empty sign-in submit remains
  disabled, unlike the baseline.

## Page performance

Fresh Chromium contexts used a 1440×900 viewport and the same three routes.
Measurements stop after network idle, a visible heading and font readiness.
Both implementations have three samples per page, collected sequentially on the
same machine. Each sample first warms its server route in a disposable page, then
opens a fresh browser context for measurement. The baseline checkout has its own
migrated and seeded local D1. CPU and network are unthrottled; background machine
load is uncontrolled. These are local lab samples, not field Web Vitals.

| Route                              | React LCP ms | Native LCP ms | React TTFB ms    | Native TTFB ms   |
| ---------------------------------- | ------------ | ------------- | ---------------- | ---------------- |
| `/`                                | 96, 92, 108  | 100, 96, 92   | 44.5, 36.5, 49.0 | 58.0, 54.1, 53.3 |
| `/sign-in`                         | 56, 64, 36   | 28, 28, 24    | 13.8, 11.5, 8.0  | 8.5, 7.9, 7.9    |
| `/docs/getting-started/quickstart` | 64, 84, 84   | 60, 60, 60    | 12.9, 21.5, 15.5 | 23.2, 23.2, 22.1 |

| Route                              | React transferred JS bytes | Native transferred JS bytes | React decoded JS bytes | Native decoded JS bytes | React / native script count |
| ---------------------------------- | -------------------------: | --------------------------: | ---------------------: | ----------------------: | --------------------------- |
| `/`                                |                     405011 |                      370341 |                1087893 |                 1548794 | 89 / 1                      |
| `/sign-in`                         |                     396131 |                      370341 |                1053821 |                 1548794 | 92 / 1                      |
| `/docs/getting-started/quickstart` |                     397100 |                      370341 |                1059636 |                 1548794 | 90 / 1                      |

Native transferred JavaScript is about 6.5–8.6% smaller, but decoded JavaScript is
about 42–47% larger. One script replaces many route/module requests. Fewer requests
and fewer transferred bytes do not establish lower parse or execution cost.
Homepage median LCP is unchanged; homepage and docs TTFB are higher in these samples.

Accumulated layout shift at the measurement boundary changed from
0.0000151 to 0.0000943 on the homepage, 0.0073802 to 0.0037036 on sign-in,
and 0.0000151 to zero on quickstart. This sum is not the session-window CLS metric.

The representative sign-in interaction fills the email field, asserts the resulting
value, then waits two animation frames. React samples were 40.3, 54.1 and 73.2ms;
native samples were 42.0, 35.0 and 34.8ms. These durations include Playwright
transport, actionability and assertion overhead. They are a repeatable end-to-end
response proxy, not input-to-paint or INP measurements. No field INP evidence was
collected, and this one interaction does not characterize the whole application.

Performance is mixed. These results support reduced transferred JavaScript, not
an overall performance improvement. Homepage and docs response timing warrant
profiling before performance claims. A follow-up should control machine load,
apply CPU/network throttling and sample authenticated workflows.

## Reproduction and retained evidence

Run local validation with the prerequisites in [setup](../setup.md#validation):

```sh
pnpm run validate
```

Capture three samples per route with embedded performance and screenshot attachments:

```sh
CI=1 E2E_PORT=3097 PLAYWRIGHT_JSON_OUTPUT_NAME=performance-results.json pnpm -C apps/web exec playwright test e2e/page-performance.spec.ts --project=chromium --no-deps --repeat-each=3 --workers=1 --reporter=json --output=test-results-performance
```

The migration session retained original exploratory logs and JSON in
`.context/foldkit/react-baseline/` and `.context/foldkit/final-performance-results.json`.
The matched replay above is in `.context/foldkit/repeated-react-performance-results.json`
and `.context/foldkit/repeated-native-performance-results.json`; each run passed all
12 captures without retries. Previously inspected final screenshots are in
`.context/foldkit/native-final-page-{0,1,2}.png`. These are ignored local artifacts;
the numeric observations above are the durable repository record. The PR records
final validation and independent review results.
