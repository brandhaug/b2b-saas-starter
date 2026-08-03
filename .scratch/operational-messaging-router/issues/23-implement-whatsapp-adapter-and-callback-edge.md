# Implement the WhatsApp Adapter and Callback Edge

Type: task
Status: resolved
Blocked by: 18, 22

## Question

Implement the production-selectable WhatsApp Cloud API adapter and provider-specific unversioned API Worker callback edge behind the provider-neutral Notifications ports. Build exact controlled-template requests, stable internal attempt correlation, effective-dated error and cost classification, throttling and timeout handling, conservative ambiguous-submission behavior, raw-body HMAC verification before parsing, independently protected challenge handling, size/method/shape rejection, encrypted provider-reference correlation, durable duplicate/out-of-order evidence ingestion before success, and best-effort wake-up publication. Keep credentials in least-authority Cloudflare secret bindings, preserve explicit `needs_configuration`, never infer failure from callback silence, and prove the adapter and callback edge against the deterministic Meta fixtures without needing a live Meta account.

## Comments

### Resolution — 2026-07-29

Implemented in `3b4f84b` and wired into the production runtime in `0205350`.

Implemented a production-selectable Meta WhatsApp Cloud API adapter behind the provider-neutral submission port. It sends the exact approved controlled-template key and ordered protected parameters, bounds native Fetch and response parsing, preserves Meta `Retry-After`, classifies only effective-dated known errors, treats transport/timeout/malformed/unknown submission results as ambiguous, and protects the `wamid` with keyed fingerprinting plus AES-GCM correlation before recording acceptance.

Added the unversioned `/callbacks/meta/whatsapp` API edge with independently protected GET challenge verification and raw-byte HMAC-SHA256 POST verification before Effect Schema decoding. Method, signature, 64 KiB size, and shape failures fail closed. Signed receipts are append-only and durable before normalized evidence; unresolved correlation returns a retryable 503 instead of acknowledging a race, while successful ingestion best-effort publishes only PII-free intent wake-ups.

Meta callback facts retain provider time, error code and policy version, pricing category/model/billability and stable `(wamid, status, timestamp, error-code)` identity. Projection uses provider chronology, keeps older-attempt failures from regressing a newer accepted attempt, schedules bounded retries only for the latest attempt's retryable evidence, quarantines true terminal contradictions, and never derives failure from silence. Provider cost amount remains correctly deferred to delivered/billing reconciliation rather than inferred from acceptance.

Production bindings split least authority: the API receives verification/correlation and Queue/D1 authority, while the Background Worker alone receives send credentials and reference-encryption authority. Missing configuration remains explicit and local/test runtimes continue to use deterministic capture.

Verification: Capabilities, API, Background Worker, and DB typechecks pass; the focused Meta/callback/lifecycle/migration suite passes 46/46; scoped `oxlint`, `oxfmt`, migration checks, and parallel Standards/Spec reviews pass with no remaining findings. The repository-wide test command reaches the pre-existing `apps/background/wrangler.jsonc` queue-concurrency drift (`4` versus canonical `1`); the same mismatch exists at `HEAD` and is outside this ticket.
