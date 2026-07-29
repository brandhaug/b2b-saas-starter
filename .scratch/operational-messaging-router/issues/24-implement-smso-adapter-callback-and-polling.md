# Implement the SMSO.ro Adapter, Callback Hint, and Polling

Type: task
Status: resolved
Blocked by: 18, 22

## Question

Implement the production-selectable SMSO.ro HTTPS adapter, provider-specific unversioned callback edge, and authenticated bounded status query behind the provider-neutral Notifications ports. Enforce form-encoded single-segment GSM-7 requests, protected response-token correlation, synchronous response and cost capture, throttling and timeout classification, no automatic replay after ambiguous submission, and explicit `needs_configuration`. Treat unauthenticated SMSO.ro callbacks only as size- and shape-limited wake-up hints that cannot mutate delivery state until polling confirms authoritative status; ingest queries idempotently, protect credentials and references, and prove send, callback, polling, duplicate, reordered, terminal, ambiguous, cost, and error behavior against deterministic fixtures without needing paid provider credit.

## Comments

### Resolution — 2026-07-29

The production-selectable SMSO.ro provider boundary now sends only form-encoded transactional requests that fit one GSM-7 segment, keeps credentials in Worker bindings, fails closed as `needs_configuration`, and treats timeouts, transport failures, provider rejection, throttling, and the provider's still-unqualified HTTP 409 semantics distinctly. A timeout, network ambiguity, 5xx, or 409 never triggers automatic replay.

Successful submissions atomically persist the encrypted `responseToken`, its provider-scoped keyed fingerprint, and the synchronous `transaction_cost` before lifecycle acceptance. Cross-attempt token collisions fail closed. Status polling uses only internally decrypted references, posts tokens in the request body rather than the URL, validates provider/fingerprint correlation, caps each batch at 100 with concurrency four, and emits stable query evidence identities into the existing idempotent, monotonic lifecycle.

The unversioned `/callbacks/smso/<secret>` API edge enforces a constant-time path-secret comparison, POST/form content type, streaming 4 KiB limit, and strict allowlisted callback shape. A callback remains an untrusted hint: Notifications uniquely correlates its fingerprint and may best-effort publish only a PII-free intent wake-up; the callback cannot write delivery evidence or mutate delivery state. Authoritative polling runs for callback wake-ups and five-minute recovery.

Deterministic fixtures cover exact submission encoding, GSM rejection, configuration failure, response cost, encrypted correlation, collision rejection, terminal HTTP errors, 409 ambiguity, 429 throttling, timeout versus transport errors, callback method/size/shape/secret handling, unknown and ambiguous hints, bounded polling, stable duplicate ingestion identity, and delivered/undelivered/expired/error status mapping without provider credit. Focused capability, API, Background Worker, lint, and workspace typechecks pass. The repository-wide test run is otherwise green but currently stops on the concurrently claimed WhatsApp ticket's temporary Background queue-concurrency config mismatch; no SMSO test fails.

Durable unknown-hint quarantine, multiple-match incidents, polling leases/cursors, reconciliation scheduling, and containment remain where already mapped: [Implement Reconciliation, Retention, and Containment](./25-implement-reconciliation-retention-and-containment.md).
