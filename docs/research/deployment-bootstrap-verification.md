# Deployment bootstrap verification

## Reproduction

From a checkout with the pinned Vite+ toolchain and dependencies installed:

```bash
pnpm run check
vp test run scripts/bootstrap-settings.test.ts scripts/deployment-token-policy.test.ts scripts/preview-bootstrap.test.ts scripts/deployment-origins.test.ts scripts/email-settings.test.ts scripts/email-sending.test.ts scripts/email-planner.test.ts scripts/email-recovery.test.ts
E2E_PORT=3118 pnpm run validate
```

The validation command runs the repository checks, build, and local browser suite.
No operator credential is needed for these checks. HTTP fixtures reject unexpected
requests and never contact Cloudflare or GitHub.

## Observed results

On 2026-10-14, integrated revision `81c3bdf5` passed `pnpm run validate`, including
62 browser tests. Eleven configured-analytics cases were intentionally skipped in
that provider-light local run; the dedicated CI analytics-consent job configures
that provider and runs those cases.

Independent Standards and Spec reviews identified and verified repairs for GitHub
operator permissions, branch-policy consistency, remote configuration drift,
sender account validation before provisioning, and dependent resource replacement.
The real Alchemy planner regression reproduces sender replacement and confirms that
privacy and event subscriptions replace with it rather than retaining the old domain.

The recovery regression also passed within the final validation. It uses the native
sender provider and both local providers with actual Alchemy drift, planning, and
apply operations. A simulated remote sender deletion recreates the sender but fails
privacy repair against its old ID. The recovery sequence resolves the new ID,
disables previews only on that sender, replaces the subscription, and converges
without further writes on the next normal drift/apply.

## Live bootstrap verification

Repeat-apply failure cases checked before the environment-reference repair:
unchanged environment variables replaced and then deleted; an unchanged account
secret deleted during replacement cleanup; token or auth-secret rotation;
loss of the environment dependency when narrowing its reference. Live repeat
applies reproduced the first two failures with whole-resource references.
Selecting the environment's `name` output preserved the dependency and changed
the plan from four replacements to updates only. Two live applies then retained
all three production variables and both production secrets. The production
environment allowed only the `master` branch; the preview gate remained false.

On 2026-10-14, bootstrap created the account-owned deployment token and published
the repository credential plus production environment settings. The operator
credential had Account API Tokens Write. GitHub authentication required exporting
`GITHUB_TOKEN` from `gh auth token`; the pinned Alchemy provider did not discover
the CLI login automatically.

The generated token verified as active. Its policy was scoped to one production
account with Workers Scripts Write, D1 Write, Secrets Store Write, and Account
Settings Write. RUM discovery returned HTTP 403, Cloudflare error 10000. Adding
only Account Settings Read to that same token made discovery return HTTP 200.
The experiment restored the initial policy, then bootstrap applied the corrected
policy with both Account Settings grants. Discovery again returned HTTP 200.
The token ID, token value, and generated auth secret stayed stable across applies.

To repeat the corrected-policy check from the protected operator checkout, load
the operator credential privately, export `GITHUB_TOKEN="$(gh auth token)"`, and
run `pnpm run bootstrap:deploy --yes` twice. Compare token IDs and secret values
locally without printing secrets. The following read-only probe uses the exact
generated credential without putting it in arguments or output:

```bash
node --input-type=module <<'JS'
import fs from 'node:fs';
const state = JSON.parse(fs.readFileSync(
  '.alchemy/state/b2b-saas-starter-deployment-access/prod/deployment-token.json',
  'utf8'
));
const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${state.attr.accountId}/rum/site_info/list`,
  { headers: { Authorization: `Bearer ${state.attr.value.__redacted__}` } }
);
const body = await response.json();
console.log({ status: response.status, success: body.success, errors: body.errors });
if (!response.ok || !body.success) process.exitCode = 1;
JS
```

Expected and observed after correction: status 200, success true. This probe
depends on the pinned Alchemy local-state encoding. It verifies list access, not
site creation or browser ingestion.

## Production rollout and browser evidence

The production CI run `38543864853` for revision `98884a24` succeeded after bootstrap
published the corrected token. All eleven jobs passed, including deployment and
its smoke checks. A separate run of the smoke command also passed:

```bash
WEB_URL=https://b2b-saas-starter-web.brandhaug.workers.dev \
API_URL=https://b2b-saas-starter-api.brandhaug.workers.dev \
node .github/scripts/smoke-deployment.ts
```

RUM discovery returned the newly created site with `auto_install: false`.
At `https://b2b-saas-starter-web.brandhaug.workers.dev`, a fresh browser session
made no vendor requests before consent or after Decline. After opening Analytics
settings and choosing Allow, exactly one beacon script loaded with HTTP 200 and
the real collector accepted its POST with HTTP 204. A second tab on `/en/privacy`
also reported successfully. Withdrawing in that tab reloaded both tabs; each
then had zero beacon scripts and zero vendor resource entries. The HAR contained
no vendor requests after withdrawal. The demo workspace displayed Analytics
settings and retained the declined preference. Authenticated workspace behavior
remains covered by the configured E2E suite rather than this live session.

To reproduce, use a fresh browser profile, record a HAR, and visit the public
origin. Check requests matching `cloudflareinsights` before consent, after
Decline, after Allow through Analytics settings, and after withdrawal in a
second tab. Expect no matching requests in the first two states, one script
and successful collector POSTs after Allow, then no further matching requests
in either tab after withdrawal. The local evidence is `analytics-rollout.har`
in the operator session's temporary artifact directory. Collector acceptance
was verified; dashboard aggregation was not checked.

## Live acceptance still required

Use the persistent protected checkout and operator credentials described in
[the deployment runbook](../deploying.md) and [email setup](../email-delivery.md).

1. Configure a separate preview account and verify credential publication before
   enabling its workflow gate. Production bootstrap and stable credentials were
   verified above; preview bootstrap remains unconfigured.
2. Deploy a same-repository preview. Verify canonical URLs and smoke checks,
   and destroy the preview with its cleanup environment. Production passed above.
3. Apply email provisioning twice against the entitled sender zone. Verify sender
   activation, disabled message-content previews, and the exact domain/queue
   subscription. Run the delivery smoke test in the email runbook.
4. Confirm analytics dashboard aggregation and repeat the
   [analytics verification procedure](browser-analytics-consent-verification.md)
   in an authenticated production workspace.

Local fixtures establish contract and engine behavior. They do not establish live
provider authorization, DNS activation, email delivery, or analytics ingestion.
