# Browser analytics consent verification

## Repeat the browser checks

Install dependencies and Chromium using [setup](../setup.md), then prepare local D1:

```sh
pnpm run db:migrate:local
pnpm run db:seed
```

The configured suite intercepts Cloudflare requests and uses a synthetic token.
It does not send test traffic to Cloudflare:

```sh
CLOUDFLARE_WEB_ANALYTICS_TOKEN=00000000000000000000000000000000 \
PRIVACY_CONTROLLER_NAME='Test Controller' \
PRIVACY_CONTACT_EMAIL=privacy@example.com \
E2E_PORT=3117 \
pnpm -C apps/web exec playwright test e2e/web-analytics.spec.ts --project chromium --workers 1
```

Run the same suite without those three configuration variables to check the
provider-light path. Supplying only the token checks that missing controller
configuration also leaves analytics inactive.

## Evidence

On 2026-10-13, the configured command above passed 13 tests, including authentication
setup/cleanup, with the unconfigured-only case skipped. The token-only dev-server
run passed the missing-controller case. The initial opt-in test failed before the
consent implementation was added.

`E2E_PORT=3118 pnpm run validate` also passed on 2026-10-13: repository checks,
build, generated-config verification, database setup and 62 E2E tests. Its 11
configured-analytics cases were skipped because this run intentionally omitted
the provider token; the separate configured run above covers them.

The mocked vendor installs an unload reporter. The suite checks actual routed
requests, so removing a script element alone cannot pass withdrawal checks.

Covered behavior:

- No vendor requests before consent or after refusal.
- Acceptance survives reload and public SPA navigation without duplicate scripts.
- Withdrawal prevents the loaded vendor's unload report and reaches other tabs.
- An expired preference stays off on load and stops an active document's reporting.
- Unavailable storage prevents acceptance; failed withdrawal writes invalidate
  previous permission without losing application access.
- Read-only local storage falls back to a disclosed refusal cookie, including new
  tabs and later reacceptance.
- Withdrawal while a script is pending leaves the replacement document inactive.
- Malformed preferences fail closed.
- Authenticated workspace pages use the same controls.

Playwright writes desktop/mobile consent screenshots and the opt-in request-count
attachment under `apps/web/test-results`. CI's `analytics-consent` artifact retains
those files and the JSON report for 14 days. The required E2E gate includes this
configured suite; the ordinary E2E shards verify the unconfigured deployment.

## Deployment verification

Follow [optional browser analytics](../deploying.md#optional-browser-analytics).
After deploying the consent implementation, enable the Alchemy switch and verify
a real opted-in beacon on the deployed hostname. Automatic injection must remain
off. Check a fresh browser before acceptance, after refusal, and after withdrawal.

Cross-tab delivery is asynchronous. Suspended tabs apply changed consent when
they resume; already-dispatched requests cannot be recalled. The manual beacon's
documented external collector is blocked during withdrawal. No supported vendor
teardown API exists, so a clean-document reload ends its observers and listeners.
