# Billing lifecycle and entitlements

The Subscribed Plan records the provider subscription; the Effective Plan determines current access. Every entitlement read applies the same clock-based decision to verified billing state, so delayed reconciliation cannot extend a known deadline. Recovery never clears an independent administrative suspension.

Incomplete first payment grants no paid access. Trials end at the verified trial deadline without renewal grace. A failed renewal for a previously paying subscription starts a fixed seven-day grace period; retries cannot move it. Verified unpaid or canceled state can end access earlier, while successful payment restores the Subscribed Plan. Period-end cancellation retains access through the paid period.

Downgrades preserve members and stored resources. Starter's three-member rule is a prompt. Where tokens or webhooks exceed Starter limits, an owner/admin chooses two token slots and one endpoint slot; a category needing selection stays paused until that choice exists. Creation, credential verification, authorization, and queued dispatch all enforce the shared selection. Token replacement transfers its selected slot. Creation counts current token leaves and every stored webhook endpoint, including disabled endpoints. Billing supplies named admission predicates evaluated inside each Live insert-and-audit batch; concurrent creators cannot spend the same remaining slot. Seed creation holds its shared inventory lock through the same admission decision and insertion.

Lifecycle state, audits, and notice outbox commit before independently retryable notices. Owners/admins keep Billing Portal recovery access; other members receive an explanation without payment details. Optional price lookup cannot prevent lifecycle or recovery controls from loading. Callers must use the shared effective-plan decision rather than infer entitlements from a workspace plan ID or provider status.

Monthly and annual prices share one Plan and its entitlements. Existing price env
vars identify monthly prices; optional `_ANNUAL` vars identify yearly prices for
Team and operator-provisioned Enterprise. Every price must be licensed, per-unit,
with interval count one, and match its configured interval. The public catalog
uses provider currency and full interval amounts. Provider-free examples are
labeled and imply no annual discount.

Checkout chooses the price server-side from the requested interval. A durable
claim blocks a competing price as well as a competing plan; retries preserve the
original quantity, URLs, and idempotency key. Existing subscriptions change
interval in the provider portal. Reconciliation recognizes both price IDs and
persists the verified interval with subscription-item period boundaries; it never adds a month or a year to
a local date. Seat changes keep next-invoice prorations. Cancellation, fixed
seven-day renewal grace, payment evidence, and non-destructive downgrade have
the same policy for both intervals.

Billing reads expose the persisted interval even when provider price lookup is
unavailable. Only an offer matching that interval receives the Current badge;
selecting another interval does not relabel the subscription. The nullable stored
interval means no verified interval is available yet. Reconciliation supplies it.
