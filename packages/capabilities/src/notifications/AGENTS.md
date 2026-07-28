# Notifications

Notifications owns provider-neutral Operational Messaging policy and contracts.
Provider adapters may unwrap protected destinations, rendered bodies, credentials,
and provider references only at the external I/O boundary. Captures, logs, queue
messages, fixtures, errors, and ordinary evidence must remain allowlisted and
redacted.

Keep fake `captured` outcomes distinct from provider acceptance and delivery.
Console/fake adapters are permitted only in explicit local and test runtimes;
other unconfigured runtimes fail closed as `needs_configuration`.

Transactional email and signed Platform Webhooks remain independent Booking
outbox consequences until their owning migration explicitly changes them.
