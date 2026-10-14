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

## Live acceptance still required

Use the persistent protected checkout and operator credentials described in
[the deployment runbook](../deploying.md) and [email setup](../email-delivery.md).

1. Apply bootstrap twice. Verify stable token IDs and auth secrets, exact selected
   account permissions, environment policies, and credential publication before
   the preview workflow gate is enabled.
2. Deploy production and a same-repository preview. Verify canonical URLs and
   smoke checks, and destroy the preview with its cleanup environment.
3. Apply email provisioning twice against the entitled sender zone. Verify sender
   activation, disabled message-content previews, and the exact domain/queue
   subscription. Run the delivery smoke test in the email runbook.
4. Verify real production analytics before consent, after decline, after acceptance,
   and after withdrawal using the
   [analytics verification procedure](browser-analytics-consent-verification.md).

Local fixtures establish contract and engine behavior. They do not establish live
provider authorization, DNS activation, email delivery, or analytics ingestion.
