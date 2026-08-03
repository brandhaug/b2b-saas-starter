# Define Verification and Launch Gates

Type: grilling
Status: resolved
Blocked by: 05, 06, 07, 08, 09, 10

## Question

Which contract, state-machine, property, adapter, callback, concurrency, financial-ledger, localization, accessibility, browser, queue-recovery, security, privacy, failure-injection, and load tests prove the router, and which measurable delivery, latency, fallback, duplicate, complaint, provider-cost, Merchant-charge, reconciliation, containment, and recovery gates make it safe to enable for every eligible Romanian Merchant with the Booking Product launch?

## Comments

### Resolution — 2026-07-29

Operational Messaging launches with the Booking Product for every eligible Romanian Merchant. There is no post-launch allowlist, pilot cohort, elapsed observation period, or production-volume requirement that delays availability. The previously charted seed-to-pilot-to-general-availability model is superseded. Launch instead requires a single evidence-backed **Messaging Launch Gate**, while post-launch safety uses scoped containment, monitoring, and recovery gates.

The launch gate is conjunctive: every required automated suite, external prerequisite, rehearsal, load test, and real-provider smoke test must pass. Security, privacy, delivery-integrity, and financial-integrity blockers are non-waivable and cannot be averaged away. A calendar deadline never overrides the evidence. Booking behavior and independent transactional email remain isolated from messaging qualification, degradation, and rollback.

The mandatory automated verification matrix is:

- Effect schema, typed-error, capability, HTTP callback, queue-envelope, and forward-compatible migration contract tests.
- Exhaustive state-machine transition and property tests covering every legal and rejected transition, monotonic projection, semantic deduplication, supersession, eligibility rechecks, bounded retry, the exact WhatsApp-to-SMS fallback boundary, ambiguous submission, terminal closure, and at most one Chargeable Delivery.
- Meta and SMSO.ro adapter contract-fixture tests covering request construction, controlled content, provider idempotency where available, synchronous classification, ambiguous outcomes, polling/query behavior, content and segment limits, throttling, configuration failure, provider-reference protection, and provider-cost capture.
- Callback tests covering raw Meta signature verification, independent challenge-token handling, SMSO.ro callbacks as untrusted wake-up hints, size/method/shape rejection, durable-before-success ingestion, duplicates, reordering, replay, unknown or ambiguous references, and contradictory terminal evidence.
- D1 concurrency tests for atomic intent preparation, reservations, ledger conversion and release, evidence ingestion, leases, worker/callback races, fresh manual-send idempotency and limits, suppression, supersession, kill switches, and scoped Merchant freezes.
- Financial property tests proving exact milli-euro arithmetic, non-negative balances, conservation across top-ups, reservations, charges, refunds, adjustments and compensating entries, source-scoped idempotency, one charge per intent, separate Provider Messaging Costs, and deterministic daily reconciliation.
- Romanian and English tests for all controlled templates, maximum fields, the 500-character WhatsApp envelope, URL-only-in-confirmation, Romanian diacritics on WhatsApp, deterministic ASCII SMS transliteration, GSM-7 validity, the one-segment limit, Shop timezone behavior, DST boundaries, quiet hours, and reminder usefulness.
- Queue-recovery and failure-injection tests at every write-ahead and external-call crash boundary, including queue publication loss, consumer crash, callback loss, D1 failure, provider timeout and throttling, missing secrets/configuration, Stripe outage, stale leases, delayed and contradictory evidence, retention interruption, and reconciliation restart.
- Tenant-isolation, role and Operator Permission, impersonation denial, callback authenticity, secret-handling, destination and provider-reference protection, PII-leak, audit atomicity, retention, deletion, crypto-erasure, abuse-limit, and incident-containment tests.
- Browser and accessibility journeys for the Booking permission step; Merchant notification settings, balance, Appointment status and fresh-send recovery; and Operations case, containment and finance workspaces. They must pass desktop Chromium, Firefox and WebKit plus Mobile Chrome and Mobile Safari profiles at 390px, including keyboard-only use and automated accessibility checks. Cosmetic differences are acceptable; blocked actions, inaccessible controls, incorrect localization, or inconsistent financial values are not.

The repository-wide coverage ratchet remains at 75% lines and statements, 65% functions, and 60% branches and may never be lowered merely to pass. Percentage coverage is not proof of the router: every legal transition, rejected transition, fallback trigger, and financial invariant requires an explicit test. A flaky gate must be fixed or removed through an evidence-backed policy change, never retried until green.

The launch load test drives 100 Merchants concurrently at the settled maximum of 20 provider submissions per Merchant per minute—2,000 submissions per minute—for 30 minutes with realistic fake-provider latency and callbacks. It permits no lost intents, platform-created duplicate submissions, duplicate charges, or ledger drift. At least 99% of immediate intents must reach first submission within 60 seconds. A simulated 15-minute Queue outage must be recovered by the five-minute durable scan and drained within 15 minutes without exceeding effective provider concurrency. Real adapters still enforce the lower limits of the provisioned accounts.

The final real-provider smoke test uses platform-controlled phones and exactly 16 sends: confirmation, reminder, cancellation, and reschedule in Romanian and English, once through WhatsApp and once through SMS. All 16 must render and arrive correctly, every SMS must remain one GSM-7 segment, provider evidence and cost must be captured, each delivered intent must create exactly one €0.045 Merchant charge, and the ledger must reconcile with no unexplained variance. This is a short pre-launch qualification, not a customer pilot or waiting period; dangerous scenarios remain in controlled failure injection.

Production service objectives and exclusions are:

- At least 98% of eligible real Notification Intents reach verified delivery within 15 minutes over a rolling 24 hours.
- At least 99% of immediate intents reach first provider submission within 60 seconds.
- At least 99% of reminders reach submission within five minutes of becoming due and entering the 08:00–20:00 Shop-time delivery window.
- At least 99% of eligible SMS fallbacks reach submission within 60 seconds of authoritative WhatsApp failure.
- Suppressed, invalid, insufficient-balance, superseded, or intentionally paused intents are excluded from the delivery denominator and remain visible as their truthful result rather than being relabelled as delivery failures.

Breaching a service objective alerts Operations and requires human investigation; it does not automatically disable otherwise safe messaging. Financial and duplicate integrity remain zero-tolerance: no duplicate Merchant charge, negative Messaging Balance, unexplained ledger or reconciliation variance, or duplicate provider delivery is permitted in any launch suite. In production, one confirmed duplicate delivery freezes the affected intent's retry and fallback path and opens a Messaging Incident. Duplicates affecting two Merchants within 15 minutes automatically pause the implicated provider/channel. BeeSolo absorbs additional provider costs but never creates a second ordinary Merchant charge.

Any credible unauthorized-message, privacy, or continued-after-suppression complaint immediately opens an incident and freezes the narrow affected destination or Merchant scope. A complaint rate above 0.5% of verified deliveries over seven days, once at least 200 deliveries exist, warns Operations. Above 1%, or when a provider account quality signal becomes critical, the affected Merchant or channel pauses pending review. Provider-reported opt-outs and blocks create Suppression Directives immediately and are tracked separately from complaints.

Every smoke-test Provider Messaging Cost must be captured and reconciled. Expected blended provider cost must remain at or below €0.036 per Chargeable Delivery, 80% of the €0.045 net Merchant charge. Crossing €0.036 warns Operations. Reaching €0.045 is critical and blocks further rollout or configuration changes, but never silently changes the Rate Card or automatically abandons already-authorized customer notifications. Legitimate fallback and duplicate-provider costs remain separately visible BeeSolo costs.

Launch is blocked by any unresolved critical or high-severity finding involving authorization, tenant isolation, callback authenticity, secrets, protected destinations, provider references, suppression, audit integrity, retention, or financial authority. A medium finding needs an owner, documented mitigation, and deadline. Before launch the team must record tabletop exercises for credential compromise, forged callbacks, ambiguous submission, duplicate delivery, and incorrect charging; each proves scoped containment, evidence preservation, recovery approval, and isolation from Booking and email.

Tests alone cannot satisfy the gate. Meta business, WABA, phone, billing, credentials, signed webhooks, and eight RO/EN Utility templates must be provisioned and qualified. SMSO.ro's production account, billing, credentials, sender, quotas, segmentation and cost behavior, callback/query contract, support escalation, and controlled cross-network qualification must be complete. Executed provider terms and the Messaging Processing Role Matrix, privacy notice, processing records, transfer assessment, and the already-required Romanian accountant memo must be in place. Production dashboards, alerts, reconciliation and retention jobs, incident runbooks, working kill-switch probes, and named response ownership are required.

Automatic containment is reserved for integrity hazards: duplicate charges, an untrusted balance, credential or encryption-key compromise, unauthorized delivery, or uncontrolled duplicate sending. It applies the narrowest Merchant, provider, or channel freeze and never rolls back the Booking Product. Delivery, latency, ordinary cost, and non-critical provider-quality degradation alert Operations for a human containment decision, except for the explicit complaint and systemic-duplicate triggers above.

An affected scope may be re-enabled only after the cause is contained, ambiguous intents and financial evidence are reconciled, relevant regression and failure-injection tests pass, production health probes pass, and residual risk is recorded. Global messaging or recovery from compromised credentials additionally requires two-person approval. Paused messages are never blindly replayed; only Notification Intents still eligible under their existing lifecycle may continue.

No new ticket or fog patch is needed. [Synthesize and Seed the Implementation Program](./12-synthesize-and-seed-implementation-program.md) is now unblocked and must translate this matrix and launch gate into dependency-ordered implementation tickets. The two provider-provisioning tickets remain behind their implementation prerequisites but now qualify routes before the Booking Product launch rather than a delayed rollout.
