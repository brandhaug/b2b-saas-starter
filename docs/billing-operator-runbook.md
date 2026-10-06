# Billing operator runbook

This runbook lets an authenticated deployment operator inspect one workspace's
billing synchronization evidence and request a retry after a provider or queue
failure. The commands use the Cloudflare API directly; there is no unauthenticated
application endpoint for billing recovery.

## Stripe API contract

The adapter pins requests to `2025-03-31.basil`. Configure the Stripe webhook
endpoint with that version or later. This version provides subscription-item
periods and invoice `parent.subscription_details`, as described in Stripe's
[Basil changes](https://docs.stripe.com/changelog/basil/2025-03-31/adds-new-parent-field-to-invoicing-objects).
Failure-history reads use event identity and creation time because Stripe retains
an event's original payload version. The adapter reads at most 100 pages of 100
invoices, starting at the current invoice and last payment; an incomplete history
remains a visible synchronization failure. Settlement evidence is compared by
payment time, and a later settlement can close an earlier failure episode before
a new failure starts its own grace deadline.

## Monthly and annual prices

`STRIPE_PRICE_ID_TEAM` identifies the monthly Team price. Add
`STRIPE_PRICE_ID_TEAM_ANNUAL` to offer annual checkout alongside it. Enterprise
uses `STRIPE_PRICE_ID_ENTERPRISE` and `STRIPE_PRICE_ID_ENTERPRISE_ANNUAL` for
operator-created subscriptions and is never self-serve. Internally,
`BillingOptions.priceIds` holds monthly prices and `annualPriceIds` holds yearly
prices, both keyed by catalog plan ID. Monthly Team plus the secret key enables
billing; annual configuration is optional. Keep every subscribed price configured
so reconciliation can still recognize it, including archived prices.

Use distinct licensed, per-unit prices with interval count one and no quantity
transform. The configured interval must match Stripe. Prices may use different
currencies; the UI displays each provider amount and currency without dividing
an annual total by twelve or inventing a discount. Without Stripe, the labeled
Team examples are USD 12 per member/month and USD 144 per member/year.

Enable subscription updates in the Stripe Billing Portal and allow exactly the
configured Team prices. Keep quantity changes controlled by workspace membership.
Existing subscribers use Manage billing to switch intervals. Stripe confirms
proration and billing-date changes in its hosted flow; the app retrieves current
provider state before changing entitlements. Interval switches can reset the
billing date and immediately charge, as documented in
[Stripe subscription updates](https://docs.stripe.com/api/subscriptions/update).
Cancellation at period end uses the provider item's end date for either interval.
Seat additions and removals keep `create_prorations`, billed on the next invoice.

A pending/open checkout for another price returns `checkout_in_progress`. Recover
or expire that session at Stripe before selecting another interval; never delete
a claim to force a second purchase. A retry of the same price retains its original
claim inputs and idempotency key.

Repeatable local checks and the separate Stripe test-mode verification path are
in [annual billing verification](verification/annual-billing.md).

## Configure the operator shell

Set the Cloudflare account credentials and the deployed resource identifiers in
the shell that runs the command. Keep the token in the environment; the script
never prints it.

```sh
export CLOUDFLARE_API_TOKEN='…'
export CLOUDFLARE_ACCOUNT_ID='…'
export CLOUDFLARE_DATABASE_ID='…'
export CLOUDFLARE_BILLING_QUEUE_ID='…'
```

The token needs D1 Read permission for inspection and Queues Write permission
for an executed retry. Cloudflare documents the D1 query endpoint in the
[D1 database query API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/)
and the queue message endpoint in the
[Queues push message API](https://developers.cloudflare.com/api/resources/queues/subresources/messages/methods/push/).
Pass `--database` or `--queue` when the resource ID is not in the environment.

## Inspect one workspace

Inspection performs parameterized, read-only D1 queries for synchronization
state, the stored Stripe subscription identity, and recent provider events.
The default provider-event result is limited to 25 rows.

```sh
pnpm run billing:operator -- inspect \
  --workspace wrk_starter

pnpm run billing:operator -- inspect \
  --workspace wrk_starter \
  --limit 100
```

Use `status`, `failure_reason`, `conflict_reason`, and `unresolved_since` to
decide whether the provider is delayed, conflicting, or already current. The
provider event rows retain the Stripe event ID, event type, provider timestamp,
attempt count, and terminal outcome needed to compare the local state with the
Stripe dashboard.

## Request an operator retry

The retry command is dry-run by default. It prints the queue name and message
that would be sent, without making a remote mutation.

```sh
pnpm run billing:operator -- retry \
  --workspace wrk_starter \
  --operator operator@example.com
```

Review the dry-run output, then add `--execute` to push one JSON message through
the authenticated Cloudflare Queues API:

```sh
pnpm run billing:operator -- retry \
  --workspace wrk_starter \
  --operator operator@example.com \
  --execute
```

The message carries `reason: "operator_retry"` and the supplied operator ID.
The background consumer records `billing.sync_retry_requested` in the audit
log before calling the billing capability. A missing operator ID is rejected by
the CLI, and a malformed queue message is acknowledged without a provider
call.

## Supply positive provider evidence

When inspection shows an unresolved checkout or a bounded Stripe listing, find
the exact Stripe customer and Checkout Session in the Stripe dashboard. Verify
that the customer metadata names the workspace and that the Checkout Session
belongs to the unresolved checkout claim before using either identifier.

Pass the identifiers to a dry-run retry so the queued message shows the
evidence that will be checked:

```sh
pnpm run billing:operator -- retry \
  --workspace wrk_starter \
  --operator operator@example.com \
  --customer cus_starter \
  --checkout-session cs_starter
```

Add `--execute` only after reviewing the dry-run output. The worker validates
each supplied identifier against the workspace and checkout claim while it
holds the billing lease. A mismatch remains a durable recovery conflict and
does not link provider records blindly. The audit event records the supplied
identifiers with the operator request.

Never edit billing rows directly in D1, and never cancel a Stripe customer or
financial resource to force recovery. Use Stripe's dashboard to locate the
matching evidence, then submit an audited retry with the identifiers.

## Lifecycle and recovery policy

Treat the provider as authoritative only after the synchronization workflow has
verified the current subscription. A completed Checkout Session is not enough
to grant paid access when the first payment is incomplete. For a subscription
that has previously paid, the first failed renewal starts a seven-day grace
deadline; subsequent retries do not move it. `unpaid` and `canceled` states
end paid access immediately. A verified successful payment restores the plan,
subject to any independent administrative suspension.

Operator-created trials grant access through the verified trial end. A trial
that does not convert returns to Starter immediately and does not receive
renewal grace. A period-end cancellation retains access until period end and
can be undone in the Billing Portal; an immediate Stripe cancellation takes
effect when verified. Refunds are performed in Stripe by the operator and are
not an application recovery action.

When access returns to Starter, do not delete members or stored resources. The
three-member seat limit is soft. If API tokens or webhook endpoints exceed
Starter limits, ask an owner/admin to select the resources that remain active;
the execution and webhook-dispatch authorization boundaries must enforce the
selection, including for existing credentials and queued work.

Stripe quantity follows every current workspace member (owners and admins
included; pending invitations excluded). Membership changes update quantity
immediately and apply proration to the next invoice.

The primary billing queue retries provider failures six times with its
configured queue backoff. After the retry budget is exhausted, Cloudflare delivers the message
to the billing dead-letter queue. Its consumer calls the authoritative
`Billing.reconcileWorkspace` operation and acknowledges the dead-letter message
when recovery is recorded. A failure while recording recovery remains retryable
on the dead-letter queue.

The background worker reconciles every minute, selecting at most 25 workspace
and unresolved-event candidates per pass. Provider latency and retry deadlines
limit throughput. Monitor unresolved age against the 15-minute repair target. Each pass records its workspace count,
drifted workspaces, and terminal conflicts in the wide event. Deployments without
complete Stripe configuration skip provider reconciliation and remain healthy.

Unresolved synchronization evidence stays available while the workspace is
unresolved. Resolved evidence has a 90-day retention policy; automated
billing-evidence pruning is not implemented.

After a retry or dead-letter recovery, inspect the workspace again and confirm
that `status` is `current`, `last_synced_at` has advanced, and the provider
event or audit trail contains the operator action.

## Purchase continuation

Public pricing links self-service Team to `/purchase?plan=team`. After sign-in,
select an eligible workspace or create one, complete privileged authentication,
and confirm on the workspace billing page. Production requires verified email;
local development does not add a mail-provider requirement. Unconfigured Stripe
leaves the continuation inspectable and checkout disabled. Starter and Enterprise
are not purchase intents. Existing subscriptions continue through the billing
portal; a selected plan never overrides that policy.

Browser regression reproduction on an isolated local database:

```bash
pnpm run db:migrate:local
pnpm run db:seed
E2E_PORT=3102 pnpm -C apps/web exec playwright test e2e/purchase-continuation.spec.ts --workers=1
```

On a host running several worktrees, prefix the browser command with
`E2E_EXPECT_TIMEOUT=20000 E2E_STARTUP_TIMEOUT=600000` to allow for shared CPU
contention. The default assertion and startup deadlines remain unchanged.

The suite covers auth return paths, the real email verification exchange,
privileged verification, workspace creation, member and foreign-workspace
refusal, invalid plans, and inactive checkout. Its
confirmation screenshot and Playwright JSON report are repeatable artifacts under
`apps/web/test-results` and `apps/web/playwright-report`. Provider subscription,
seat quantity, and durable retry contracts remain in the existing Billing tests.
Hosted Stripe completion requires a configured Stripe test account.
