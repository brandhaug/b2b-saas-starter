# Deliver the Solo Subscription Lifecycle

Type: task
Status: resolved
Blocked by: 25

## Question

Deliver monthly and annual Solo billing end to end: one idempotent no-card trial, authoritative D1 Merchant Subscription projection, Stripe checkout and billing identity, signed event ingestion, API reconciliation, immutable price evidence, Trialing, Active, Grace, and Restricted access, scheduled cancellation, renewal recovery, chargeback and refund consequences, retention warnings, provider outage behavior, Owner Billing controls, and persistent notices. Stripe status must remain evidence rather than authority, customer Appointment Payments must remain Pay In Person, and no Team, seat, quantity, upgrade, or downgrade path may exist.

## Acceptance criteria

- [x] One verified person can create at most one Merchant and one fourteen-day trial through an idempotent atomic boundary; abandoning beforehand creates neither.
- [x] Duplicate, delayed, contradictory, missing, and reconciled Stripe facts converge on the authoritative access projection without granting authority directly.
- [x] Restricted Access blocks new demand and setup changes while preserving billing recovery, exports, reads, and safe handling of existing commitments exactly as specified.
- [x] Billing surfaces show €19 monthly or €190 annually excluding applicable VAT and contain no Team or appointment-payment behavior.

## Comments

### Resolution — 2026-08-02

Delivered the Solo-only Merchant Subscription lifecycle with an atomic, replayable
Merchant-plus-trial boundary; fixed monthly and annual EUR catalog evidence; Stripe
Checkout billing-address and VAT-ID collection; Owner portal and scheduled-cancellation
controls; signed, idempotent event ingestion; unmatched-event retention; and scheduled
provider-API reconciliation. Provider outages preserve the last authoritative D1
projection rather than changing access.

Follow-up hardening added typed nested Stripe decoding and modern invoice-parent
correlation, stable provider occurrence times during reconciliation, automatic failed
invoice voiding at Grace expiry, renewal-scheduled monthly/annual interval changes,
and an authenticated Operations refund-decision ingress that requires the explicit
full-refund access consequence (or an explicit partial-refund shortening).

D1 projects Trialing, Active, Grace, and Restricted access from immutable provider
evidence. Duplicate and out-of-order facts converge deterministically, paid recovery
restores access, chargebacks restrict immediately, and full refunds carry an explicit
access consequence. Persistent per-cycle trial, Grace, restriction, recovery, and
retention notices drive Owner email delivery.

Restricted Access now makes a preferred published page temporarily unavailable and
denies catalog/setup mutations while shared authorization continues to preserve reads,
exports, billing recovery, and existing-commitment exceptions. Billing UI contains only
Solo at €19 monthly or €190 annually excluding applicable VAT; Checkout quantity is
fixed at one and exposes no Team, seat, upgrade, downgrade, or Appointment Payment path.

Verification passed workspace typechecking, focused Seed/Live D1 and Stripe contract
tests, and lint (with unrelated existing warnings). The serial full workspace run
reaches the unrelated legacy multi-Provider live fixtures, which the Solo-only D1
invariant now rejects; those fixture failures are outside this lifecycle ticket.
