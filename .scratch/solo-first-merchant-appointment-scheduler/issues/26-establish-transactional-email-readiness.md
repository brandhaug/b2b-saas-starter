# Establish Transactional Email Readiness

Type: task
Status: resolved
Blocked by: 25

## Question

Deliver the narrow required Transactional Email seam that Merchant Activation can trust: controlled Romanian and English templates, platform sender identity, an Effect provider boundary, accepted-versus-failed delivery evidence, provider-light development behavior, needs-configuration production state, an Owner test-email command, Notification Readiness projection, secrets and callback verification, and observable retry-safe delivery without yet implementing every Appointment, Walk-in, Waiting List, or reminder producer.

## Acceptance criteria

- [x] The Owner can send the activation test to the verified account destination and receive durable accepted or failed evidence through the real capability boundary.
- [x] Production cannot become Notification Ready when the required provider or verified sender is absent, while local development remains usable through an explicit controlled adapter.
- [x] Template, locale, destination, submission, callback, retry, signature, duplicate, timeout, and redaction contracts have deterministic adapter tests.
- [x] Email failure never mutates unrelated domain state or masquerades as successful delivery.

## Comments

### Resolution — 2026-08-02

Added the Effect `TransactionalEmail` capability with controlled Romanian and English
Owner activation-test templates, verified-account destination resolution in Live D1,
explicit local/test capture, and production fail-closed selection requiring the email
binding, platform sender, sender-verification attestation, and callback secret.

Provider acceptance, trustworthy callback delivery, permanent failure, and ambiguous
timeout are distinct durable evidence states. Submission is write-ahead and idempotent;
timeouts become `submission_unknown` and are never blind-resubmitted. Provider
references are fingerprinted, destinations are masked outside the I/O boundary, HMAC
callbacks enforce a five-minute window, and callback event IDs are durable duplicate
guards. The API exposes the narrow transactional-email callback ingress.

Focused deterministic and Live D1 tests passed (9 tests), as did formatting, scoped
lint, and the API/capabilities/database typechecks. The full workspace run reached
unrelated existing failures: a Miniflare `EADDRNOTAVAIL` resource failure and legacy
Merchant Catalog Live fixtures that violate the Solo Owner-Provider invariant.
