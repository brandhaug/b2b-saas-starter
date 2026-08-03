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

### Reopened — 2026-08-03

Reopened after the exact-commit rereview found that the Owner command was not reachable,
the production adapter fabricated callback correlation, callback ordering and retries
were not concurrency-safe, invalid callbacks were acknowledged, Live failed readiness
was lost, and the callback edge bypassed the Effect HTTP API contract.

### Repair resolution — 2026-08-03

The production adapter now consumes Cloudflare's real `messageId`, carries the stable
command key in a supported email header, and converts provider message and event IDs to
keyed HMAC fingerprints at the I/O boundary. Provider codes and occurrence times are
normalized before persistence. The central environment catalog forwards the verified
sender attestation, callback secret, and fingerprint key to deployed Workers.

Live D1 uses atomic first-send and safe-retry claims, rejects same-key changed payloads
with exact destination fingerprints, reconciles callbacks that precede acceptance, and
prevents duplicate or out-of-order terminal regressions. The migration safely replays
legacy terminal evidence, fails closed on unverifiable legacy retries, and intentionally
does not retain legacy callback receipts containing raw provider event IDs. Seed and Live
readiness now agree for failure and ambiguous submission outcomes.

The Owner activation surface reports accepted, delivered, captured, failed, and unknown
evidence truthfully. Callback ingress is part of the typed Effect HTTP API and rejects bad
signatures with HTTP 400. Focused capability, Live D1, HTTP contract, and environment
verification passed (33 tests), along with scoped formatting, lint, and DB/API typechecks.
The full workspace run still encountered unrelated concurrent-work failures in the
foundation migration suite and shared Merchant Catalog typing. Cloudflare provider-level
deduplication and live delivery-callback sourcing remain release qualification concerns;
the capability does not claim either as proven provider behavior.
