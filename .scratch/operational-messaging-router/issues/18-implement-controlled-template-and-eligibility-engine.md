# Implement the Controlled Template and Eligibility Engine

Type: task
Status: resolved
Blocked by: 16, 17

## Question

Implement the Notifications-owned, versioned Romanian and English template catalog and deterministic renderer for confirmation, one reminder, cancellation, and reschedule. Enforce immutable controlled-field limits, Merchant identification, the 500-character WhatsApp envelope, Romanian diacritics on WhatsApp, deterministic ASCII transliteration and GSM-7 counting for one-segment SMS, and URL-only-in-confirmation before reservation or submission. Add provider-template approval metadata and exact-version eligibility, Operational Messaging Permission and scoped suppression evaluation, Shop-timezone 08:00–20:00 reminder usefulness, immediate-event behavior, destination normalization/masking/protection, configuration and kill-switch checks, and exhaustive fixture tests for maximum fields, DST, invalid content, disabled versions, and every ineligibility reason.

## Comments

### Resolution — 2026-07-29

Implemented and verified the controlled template and eligibility boundary in commits `3a42b29`, `fae57fe`, `dacf8a1`, and `1723074`.

- Added a Notifications-owned RO/EN catalog for confirmation, reminder, cancellation, and reschedule across WhatsApp and SMS. Template bodies are immutable by version, their patterns are tied to runtime SHA-256 fingerprints, changed SMS launch copy is represented as `v2`, and retired `v1` rows remain unchanged.
- Added deterministic rendering with required controlled fields, fixed field and channel envelopes, Merchant identification, trusted confirmation URLs only, Romanian WhatsApp diacritics, printable-ASCII SMS transliteration, GSM-7 accounting, and maximum-field fixtures capped at 500 WhatsApp characters and 155 SMS septets.
- Added protected Romanian destinations with normalization, masking, HMAC fingerprints, randomized AES-GCM ciphertext, and redacted material at ordinary boundaries.
- Added exhaustive fail-closed eligibility for Operational Messaging Permission, destination identity, Merchant/Shop/customer/provider suppression, channel and route controls, provider configuration, kill switches, exact enabled versions, WhatsApp approval/category/evidence, pattern matching, useful reminder timing, and invalid content.
- Added Shop-timezone 08:00–20:00 reminder scheduling with DST coverage while preserving immediate confirmation, cancellation, and reschedule behavior.
- Added persisted approval metadata and D1 invariants, a Live D1 catalog adapter with typed failure mapping, and Seed/Live layer wiring.

Verification passed: Capabilities `61` files / `343` tests, Database `7` files / `14` tests, scoped type-checking, linting, and formatting. The one full-monorepo run encountered an unrelated Merchant navigation-loading timeout under parallel load; the same test passed in the owning package (`4/4`) when rerun with its package configuration.

The final two-axis review found no unresolved standards or specification violations. It retained one non-blocking maintenance observation: adding a template version currently requires coordinated updates to the pattern/fingerprint catalog, migration rows, and snapshots, although runtime fingerprint verification fails closed on drift.
