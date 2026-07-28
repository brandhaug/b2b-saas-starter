# Expand D1 for Operational Messaging

Type: task
Status: resolved
Blocked by: 16

## Question

Add forward-only D1 migrations, schema definitions, Live and Seed adapters, and clean/upgrade migration tests for the Notifications-owned mobile lifecycle: Notification Intents, Delivery Routes, Submission Attempts, Provider Evidence, protected destinations and provider references, template versions and controlled facts, Suppression Directives, channel and Merchant controls, leases, Messaging Balance reservations and append-only ledger entries, Chargeable Deliveries, Provider Messaging Costs, reconciliation cases, incidents, retention tombstones, and safe read projections. Preserve existing booking, email, webhook, and console-capture data during expansion; add the constraints and source-scoped identities needed for monotonic evidence, semantic deduplication, one reservation and charge per intent, exact milli-euro arithmetic, and tenant isolation; do not switch producers or replay historical messages in this slice.

## Comments

### Resolution — 2026-07-29

Commit `6018753` adds the forward-only `20260729120000_operational_messaging` D1 migration and matching Drizzle definitions. The additive model covers the complete Notifications-owned lifecycle named in this ticket, seeds the launch €0.045 Rate Card as 45 milli-euros, preserves the existing Booking outbox and its independent email, webhook, and console-capture fields, and neither switches producers nor replays historical work.

Composite ownership keys now bind Routes, Attempts, Evidence, reservations, charges, costs, reconciliation cases, and ledger intent references to the same Shop and Notification Intent. Source-scoped evidence and provider-message-status identities make duplicate observations idempotent; append-only triggers protect Provider Evidence and Messaging Balance Ledger Entries. Rate-card/amount foreign keys, reservation snapshot keys, one-charge partial uniqueness, positive integer checks, and required delivery-charge provenance prevent rounding, duplicate-charge, null-intent, cross-tenant, and reservation/charge mismatch bypasses.

Protected destination and provider-reference records separate ciphertext, keyed fingerprints, masked display data, and key versions. Crypto-erasure requires protected and display values to disappear together. Retention tombstones, leases, suppression directives, channel and Merchant controls, reconciliation cases, incidents, and eight allowlisted views provide the durable recovery and safe-read foundation for later lifecycle and actor-surface tickets without exposing ciphertext, raw provider references, or body fingerprints.

The typed `MessagingReadModel` has Seed and Live implementations in the Notifications capability and is wired into both runtime layers. It exposes tenant-scoped Merchant delivery and exact balance projections plus safe Operations snapshots for cases, route/evidence progress, charges, provider costs, incidents, and channel controls. Every Live row is decoded through its Effect schema and malformed persistence maps to `CapabilityUnavailable`.

Verification passed for the complete database suite (6 files, 10 tests), complete capability suite (59 files, 291 tests), focused clean/upgrade and Seed/Live parity tests, package typechecks, scoped `oxlint`, formatting, and diff checks. The full monorepo run reached two unrelated pre-existing five-second parallel-load timeouts; both affected tests passed immediately in isolation (Merchant navigation: 4/4; Booking scheduling Live: 4/4). The required two-axis review finished with no documented-standards violation and no blocking specification issue; two non-blocking duplication smells remain around repeated lifecycle literals and optional Drizzle query construction.

No new ticket or fog graduation is required. [Implement the Controlled Template and Eligibility Engine](./18-implement-controlled-template-and-eligibility-engine.md) and [Implement Messaging Balance and the Rate Card](./19-implement-messaging-balance-and-rate-card.md) are now unblocked.
