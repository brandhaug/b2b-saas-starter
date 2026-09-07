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

## Queue and reconciliation behavior

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

The background worker also runs a bounded reconciliation pass every minute. It
selects at most 25 workspace and unresolved-event candidates per pass. That is
a ceiling of 1,500 candidates per hour; provider latency, event recovery, and
retry deadlines reduce the number of workspace repairs. Monitor unresolved age
against the 15-minute repair target. Each pass records its workspace count,
drifted workspaces, and terminal conflicts in the wide event. Deployments without
complete Stripe configuration skip provider reconciliation and remain healthy.

Unresolved synchronization evidence stays available while the workspace is
unresolved. Resolved evidence is retained for 90 days after resolution; issue
#290 owns the consolidated cleanup job and its retention implementation.

After a retry or dead-letter recovery, inspect the workspace again and confirm
that `status` is `current`, `last_synced_at` has advanced, and the provider
event or audit trail contains the operator action.
