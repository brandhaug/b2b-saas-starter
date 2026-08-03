# Integrate Booking Intent Producers and Cut Over Mobile Work

Type: task
Status: resolved
Blocked by: 20

## Question

Integrate Notifications' opaque intent-preparation mutations into confirmation, cancellation, reschedule, and reminder-producing Booking transactions so each domain change atomically commits the current version-bound mobile consequence without provider work. Record Scheduled reminders only as Notification Intents, supersede obsolete intents atomically, and emit PII-free versioned `notification-intent` wake-ups while preserving independent `booking-outbox` email and Platform Webhook work. Add the compatibility consumer contract for the legacy `{ outboxId }` envelope, migrate only genuinely pending future reminders for which no provider submission could have occurred, remove mobile linkage and the legacy console-WhatsApp branch from `booking_outbox` only after replacement tests pass, and prove upgrade cutover cannot replay historical confirmations, cancellations, or reschedules.

## Comments

### Resolution — 2026-07-29

Implemented and verified the Booking producer cutover in commit `1e510ce`.

- Added a schema-validated Notifications preparation boundary that returns opaque
  D1 mutations for protected destinations, controlled facts, ordered routes, and
  version-bound Notification Intents.
- Composed confirmation, cancellation, reschedule, reminder, and supersession
  mutations into their owning Booking transactions, with post-commit PII-free
  versioned wake-ups and fail-closed optional destination protection.
- Preserved `booking_outbox` solely for independent email and Platform Webhook
  work, removed its mobile linkage and console-WhatsApp processing branch, and
  centralized the versioned Queue envelope with legacy `{ outboxId }` decoding.
- Added a forward-only migration that stages one strict set of genuinely pending
  future reminders, normalizes only that set, cancels its legacy scheduled work,
  and leaves historical or incomplete work untouched.

Verification passed: Booking `44` files / `223` tests, Background `3` files / `13`
tests, Capabilities `65` files / `376` tests with coverage above all thresholds,
Database `8` files / `16` tests, all `25` monorepo type-check tasks, scoped and
monorepo linting, formatting for every changed implementation file, and final
Standards and Spec reviews with no remaining findings. The repository-wide format
check still reports unrelated pre-existing Merchant and research files.
