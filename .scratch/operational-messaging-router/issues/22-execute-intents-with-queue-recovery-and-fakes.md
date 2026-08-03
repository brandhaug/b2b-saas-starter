# Execute Intents with Queue Recovery and Fake Providers

Type: task
Status: resolved
Blocked by: 21

## Question

Extend the existing `booking-events` Queue consumer and five-minute Background Worker recovery scan to dispatch both legacy-compatible booking outbox wake-ups and versioned Notification Intent wake-ups to their owning capabilities without interpreting business state. Implement short leases, due-work discovery, pre-submission atomic eligibility and reservation, write-ahead Submission Attempts, external calls outside D1, durable evidence ingestion before acknowledgement, safe stale-lease recovery, bounded concurrency and abuse controls, and best-effort queue publication whose loss costs latency rather than work. Demonstrate confirmation, reminder, cancellation, reschedule, insufficient balance, suppression, supersession, retry, fallback, ambiguity, crash recovery, and independent email behavior end to end with deterministic fake providers before any live credential is required.

## Comments

### Resolution — 2026-07-29

Implemented in `2b33960`, hardened in `f08e3b6`, and completed with the independent-email worker proof in `a94c937`.

- The shared `booking-events` consumer now decodes versioned booking-outbox and Notification Intent wake-ups, delegates both to their owning capabilities, and acknowledges only after durable processing succeeds. Queue publication remains a latency optimization because the five-minute D1 due-work sweep discovers pending Intents independently.
- Notifications now owns D1-backed due discovery, bounded per-Shop selection, fresh permission/control/suppression checks before reservation and submission, write-ahead attempts, protected destination reveal only at the provider boundary, durable outcome/evidence recording, conservative stale-submission recovery, retry/fallback behavior, and fail-closed non-local provider configuration.
- Deterministic Meta and SMSO.ro fakes cover capture, rejection, throttling, ambiguity, retry, fallback, suppression, supersession, insufficient balance, and all four launch purposes. Capture identities include the attempt identity so evidence remains correlatable across independently constructed Queue and recovery runtimes.
- Worker-level integration tests provision real D1, execute both Queue and scheduled-recovery paths, prove evidence is durable before acknowledgement, and prove legacy email wake-ups remain independently processable.
- Queue and recovery execution are conservatively serialized at launch while D1 due discovery additionally enforces the ten-per-Shop bound.

Verification: monorepo typecheck passed (25/25 tasks); Background passed 15/15 tests; Capabilities passed 385/385 tests with coverage above configured thresholds; scoped `oxlint`, `oxfmt`, architecture checks, and the two-axis code review passed with no remaining hard finding.
