# Durable billing synchronization

Date: 2026-09-07

Webhook redelivery and best-effort seat messages cannot repair every interrupted
billing operation. Billing therefore stores provider event evidence, checkout
claims, and per-workspace synchronization state in D1. A scheduled pass repairs
missed work without another membership change. This supersedes ADR 0060's reliance
on the next customer action or provider event for recovery.

## Authority and ordering

Stripe owns subscription state. The application owns billable membership. Events
trigger a read of current Stripe state rather than replaying their payload onto
entitlements. Event timestamps remain evidence; they do not decide ordering, since
distinct legitimate changes can share a second. Recognized Stripe price changes
update the plan, and reconciliation corrects Stripe quantity to membership.

One workspace owns one customer and at most one current subscription. Cancellation
retains the customer for invoice history. Unknown prices, ownership mismatches,
and multiple subscriptions preserve the last verified plan and produce durable
conflict evidence. Recovery never cancels subscriptions, refunds payments, or
reassigns customers automatically. Payment and access transition rules belong to
issue #284; synchronization provides the place to apply those rules.

## Interrupted work and concurrency

A per-workspace lease serializes billing work. A fencing token prevents a worker
whose lease expired from committing stale local state. Provider calls remain
outside D1 batches. Required local state, audit rows, and event completion commit
atomically; a retry can recover an event left processing by a crash.

Checkout persists its claim and immutable request parameters before calling
Stripe. Same-plan attempts reuse the pending session, competing plans wait until
it expires or is canceled, and existing subscribers use the Billing Portal.
Customer and checkout creation reuse durable claim keys. Seat repair reads the
current provider quantity before writing the absolute desired quantity; an
applied write becomes a no-op on retry. A fresh drift observation gets a new key,
so a quantity returning to an earlier value is not suppressed by Stripe's cache. Ambiguous creation must be recovered
before a new generation can begin, including after Stripe's idempotency retention
window. Stripe may remove an idempotency key after 24 hours, so durable
claim recovery must outlive that window; see [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests).

## Recovery and evidence

A bounded scheduled pass reconciles linkage and seats. It stays inactive without
Stripe configuration, preserves verified state during outages, and emits drift,
reconciliation outcomes, and terminal failures through existing observability.
The billing page displays pending, delayed, or conflict state while retaining the
last verified plan. The normal repair target is 15 minutes while Stripe is
available; unresolved synchronization must raise an alert after 15 minutes.

Retain event IDs, associated workspace and subscription IDs, processing outcomes,
timestamps, and sanitized errors for 90 days. Never retain raw webhook payloads.
Unresolved failures remain until resolution, when their 90-day clock begins.
Issue #290 owns consolidated cleanup and the separate audit-retention policy.
Events older than retained evidence remain safe because processing retrieves
current provider state. Operator inspection and single-workspace retries provide
recovery without a new administration screen; retries produce audit evidence.
