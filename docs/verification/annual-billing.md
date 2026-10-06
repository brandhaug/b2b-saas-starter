# Annual billing verification

This change adds optional annual licensed prices alongside monthly prices. It
keeps the same Plan entitlements, member-based quantities, checkout claims,
provider reconciliation, fixed renewal grace, and non-destructive downgrade.

## Repeat locally

Use port 3103 for this worktree. D1 tests and browser preview need local process
and port access. Install Chromium as described in [setup](../setup.md#validation).

```sh
vp test run packages/billing/src/stripe-pricing.test.ts packages/billing/src/checkout-claims.test.ts packages/billing/src/billing-state.test.ts
pnpm -C packages/capabilities exec vp test run src/billing/billing-lifecycle.live.test.ts src/billing/checkout.live.test.ts
pnpm -C apps/web exec vp test run src/components/workspace-billing.test.tsx src/lib/server/billing.effects.test.ts
E2E_PORT=3103 pnpm -C apps/web exec playwright test e2e/annual-pricing.spec.ts
E2E_PORT=3103 pnpm run validate
```

The browser test opens `/en/pricing`, selects Annual, checks the complete USD 144
per-member/year example and its label, captures desktop and mobile screenshots,
and switches back to the USD 12 monthly example. Screenshots are written to the
test's directory under `apps/web/test-results`. The machine-readable report is
`apps/web/playwright-report/results.json`.

## Observed local results

- Production build passed, including the browser/server import boundary check.
- Initial focused checks passed: 44 billing policy/price/claim assertions,
  18 Live/D1 checkout/lifecycle tests, and 28 web/component tests. The final
  interval-display repair is being revalidated separately.
- Broad validation encountered unrelated authentication tests exceeding their
  five-second deadlines under concurrent worktree load. No test timeout was
  changed to hide those failures.

## Evidence scope

The protocol tests use local Stripe HTTP fixtures and a real local D1 database.
They cover annual checkout price/quantity and durable competition, stored annual
interval/period, portal-driven interval changes, next-invoice seat prorations,
period-end cancellation, fixed renewal grace, and retained Subscribed Plan after
paid access ends. Price validation covers actual currency units, configured
interval mismatch, and rejection of unsupported recurrence, metered, tiered, and
transformed prices. UI tests distinguish the current subscription interval from
the selected offer and refuse an unlabeled example as a provider price.

The initial test-first run failed on annual price validation, competing checkout
claims, and annual subscription recognition before implementation. The review
repair also first failed an assertion for the missing verified interval.

No real Stripe test-mode or live-mode calls were made. Before enabling annual
billing in a deployment, configure both Team prices and the portal as described
in the [operator runbook](../billing-operator-runbook.md#monthly-and-annual-prices).
In Stripe test mode, verify annual checkout with multiple members, add/remove a
member, switch both interval directions in the portal, cancel at period end,
advance renewal with successful and failed payment, and reconcile after a missed
webhook. Compare invoice amounts, proration lines, currency, item periods, and
local billing evidence. Provider fixtures do not certify those hosted flows.

## Integration

The additive migration stores a nullable verified interval. No reset or reseed is
required for deployed data; reconciliation fills it for existing subscriptions.
Unknown intervals receive no Current offer badge. Keep subscribed price IDs in
configuration, including archived ones, so reconciliation can recognize them.

This branch is independent of the other opportunity worktrees. Integration may
need to reconcile edits to the billing UI/server input, environment keys, shared
message catalogs, `schema.ts`/`enums.ts`, and generated migration snapshots. Apply
all independent migrations and generate a consistent follow-up schema snapshot;
do not discard the other branch's schema changes. No sibling branch was merged.
