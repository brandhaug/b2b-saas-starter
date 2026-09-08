# Billing lifecycle and entitlements

The Subscribed Plan records the provider subscription; the Effective Plan determines current access. Every entitlement read applies the same clock-based decision to verified billing state, so delayed reconciliation cannot extend a known deadline. Recovery never clears an independent administrative suspension.

Incomplete first payment grants no paid access. Trials end at the verified trial deadline without renewal grace. A failed renewal for a previously paying subscription starts a fixed seven-day grace period; retries cannot move it. Verified unpaid or canceled state can end access earlier, while successful payment restores the Subscribed Plan. Period-end cancellation retains access through the paid period.

Downgrades preserve members and stored resources. Starter's three-member rule is a prompt. Where tokens or webhooks exceed Starter limits, an owner/admin chooses two token slots and one endpoint slot; a category needing selection stays paused until that choice exists. Creation, credential verification, authorization, and queued dispatch all enforce the shared selection. Token replacement transfers its selected slot.

Lifecycle state, audits, and notice outbox commit before independently retryable notices. Owners/admins keep Billing Portal recovery access; other members receive an explanation without payment details. Optional price lookup cannot prevent lifecycle or recovery controls from loading. Callers must use the shared effective-plan decision rather than infer entitlements from a workspace plan ID or provider status.
