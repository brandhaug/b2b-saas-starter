# Establish the Deterministic Provider Contract Harness

Type: task
Status: resolved
Blocked by:

## Question

Implement the provider-light test foundation that every later router slice can share: typed provider-neutral request, response, callback, query, cost, and failure contracts; deterministic Romanian and English console/fake Meta and SMSO.ro adapters; fixed clocks and identifiers; redacted capture records; and reusable contract fixtures for acceptance, rejection, throttling, timeout, ambiguous submission, duplicate and reordered evidence, terminal failure, delivery, and contradictory evidence. Keep fake `captured` outcomes distinct from provider acceptance or delivery, select `needs_configuration` outside explicitly local/test runtimes, preserve the independent existing email and webhook behavior, and prove that fixtures, logs, and queue-shaped data contain no destination, Confirmation capability, credential, raw provider reference, or rendered body.

## Comments

### Resolution — 2026-07-29

Commits `f79d18c`, `9d3d066`, and `acdbf7c` establish the Notifications-owned provider contract harness. Effect schemas and typed services now cover provider-neutral submission, callback verification, provider query, Provider Messaging Cost, queue wake-up, capture, evidence, and normalized failure boundaries. Protected destinations, rendered bodies, credentials, callback bodies, signatures, and raw provider references use non-serializable redacted values; identifiers, UTC instants, template versions, normalized codes, and SHA-256 fingerprints are runtime-validated.

One deterministic Effect layer supplies Meta/WhatsApp and SMSO.ro/SMS fakes across submission, callback, query, and cost ports with fixed clocks and identifiers. Local and test submissions produce a distinct `captured` outcome plus an allowlisted masked capture record; preview and production fail closed as `needs_configuration`. The shared fixture catalog covers acceptance, rejection, throttling, timeout, ambiguous submission, duplicate and reordered evidence, terminal failure, delivery, contradictory evidence, callbacks, queries, costs, and PII-free queue wake-ups.

Contract tests capture the real Effect logger and prove that fixtures, captures, logs, and queue-shaped data exclude raw destinations, Confirmation capabilities, credentials, raw provider references, and rendered bodies. Runtime decoding rejects unsafe fingerprints and impossible Meta/SMS or SMSO.ro/WhatsApp pairs before capture. The existing independent email, Webhook, and legacy console-capture paths were unchanged and their focused Background Worker tests remain green. No new ticket or fog graduation is required.
