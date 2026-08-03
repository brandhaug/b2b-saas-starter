# Define the Routing and Delivery Lifecycle

Type: grilling
Status: resolved
Blocked by: 01, 02, 03, 14

## Question

What canonical aggregates, states, invariants, and transitions govern one Notification Intent from eligibility and maximum-cost reservation through WhatsApp submission, transient retry, explicit terminal fallback to SMSO.ro, provider acceptance, delivery, failure, suppression, insufficient balance, manual fresh send, supersession, reconciliation, and final charging without blocking the originating Booking Product change or promising exactly-once delivery?

## Comments

### Resolution — 2026-07-27

One **Notification Intent** is the aggregate root for one semantic Operational Notification and owns its complete ordered channel journey. Its immutable identity includes purpose, source aggregate and version, recipient role and snapshot, and semantic deduplication key. It owns WhatsApp and SMS **Delivery Routes**, their append-only **Submission Attempts**, the overall lifecycle, supersession facts, and one possible **Chargeable Delivery**. **Messaging Balance** remains a separate aggregate referenced through one reservation. A manual send never reopens an intent: an idempotently retried manual command returns its existing fresh intent, while a deliberately new command creates another intent from the Appointment's current state.

Intent progress and result are separate. Nonterminal phases are **Scheduled**, **Ready**, **Routing**, and **Awaiting Provider**, followed by **Terminal**. Terminal results are **Delivered**, **Not Sent**, and **Delivery Failed**. Not Sent carries a pre-delivery reason such as `suppressed`, `insufficient_balance`, `superseded`, or `no_eligible_route`; Delivery Failed means at least one provider submission occurred but no permitted route delivered. Worker claims, leases, retry counters, and reconciliation cursors are operational metadata rather than intent states.

Each Delivery Route progresses monotonically through **Planned**, **Eligible**, **Submitting**, **Accepted**, and **Delivered**, with **Ineligible**, **Submission Unknown**, and **Terminal Failure** alternatives. An explicit response proving non-acceptance may be classified as retryable or terminal; a retryable response creates a new bounded Submission Attempt after backoff. A timeout or lost response becomes Submission Unknown. That state allows reconciliation only: it prohibits automatic resubmission and SMS fallback because the original request may have been accepted. Provider acceptance is not delivery and never triggers charging.

Eligibility is checked during routing and again immediately before submission. It includes the intent still being current, Merchant and notification-type enablement, global channel controls, valid controlled content and destination, provider configuration, and applicable Suppression Directives. Suppression can cover all operational channels or one named channel. A WhatsApp-only suppression can permit the disclosed SMS fallback; an all-channel suppression terminates the intent as Not Sent. Invalid destinations and transient provider failures are route outcomes rather than durable suppression unless explicit evidence establishes a directive.

After eligibility but before the first provider request, the router must atomically acquire one **Messaging Balance Reservation** for the maximum Merchant charge among the intent's remaining permitted routes. No provider submission starts without it. The reservation survives WhatsApp retries, acceptance, terminal failure, and permitted SMS fallback. Insufficient balance terminates the intent as Not Sent and is never replayed after funding. A terminal intent without delivery releases the full reservation; a delivered intent converts only the final charge and releases the remainder.

WhatsApp is attempted first. SMSO.ro becomes eligible only when WhatsApp is ineligible before submission, explicitly rejects submission terminally, or reports an authoritative terminal delivery failure. Delay, missing callbacks, Accepted, and Submission Unknown never activate fallback. Duplicate and out-of-order provider observations cannot regress a route projection.

Every submission response, callback, provider query, and explicit Operator reconciliation is immutable **Provider Evidence**. Projection is idempotent by evidence identity and provider message identity. Verified delivery is final for routing. SMSO.ro callbacks remain untrusted hints until polling confirms them. Contradictory terminal evidence is quarantined for reconciliation and cannot automatically trigger fallback or a second charge. Reconciliation resolves uncertainty from authoritative evidence; elapsed time or absence of evidence alone cannot prove non-delivery. Corrections append adjustments rather than rewriting historical evidence.

A domain change atomically supersedes obsolete version-bound intents and appends any replacement intent. If no submission may have been accepted, the old intent becomes Not Sent, releases its reservation, and stops. If a route is Accepted or Submission Unknown, supersession is recorded as `superseded_after_submission`; retries and fallback stop, but reconciliation continues because the message cannot truthfully be recalled. A later delivery remains Delivered with supersession context, while a later terminal failure remains Delivery Failed.

At most one verified delivery becomes the Chargeable Delivery for an intent. Its idempotent commit converts the reservation using the snapshotted effective rate and actual chargeable units. Provider costs are recorded separately for every applicable provider message. If contradictory late evidence shows that both channels delivered, the Merchant still receives one ordinary charge and the platform absorbs the additional provider cost. Later ledger reconciliation may append corrections but cannot create a second ordinary delivery charge for the intent.

The originating D1 transaction atomically commits the Booking Product change and minimal Notification Intent without provider calls, routing, balance reservation, or other external work. After commit, all messaging outcomes are isolated from the Appointment lifecycle. Queue messages are at-least-once wake-ups and cron recovers committed work. Semantic keys deduplicate automatic intents; unique transition, evidence, and charge guards make repeated processing safe. Provider idempotency is used when available, but the product promises durable processing and explicit outcomes—not exactly-once customer receipt.

The rate-card and ledger entries, D1 and Effect module shape, callback security and retention, retry and reconciliation thresholds, UI projections, and staged-release measurements remain with their existing downstream tickets. No new ticket or fog graduation is required.
