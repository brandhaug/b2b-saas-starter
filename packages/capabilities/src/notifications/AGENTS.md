# Notifications

Notifications owns provider-neutral Operational Messaging policy and contracts.
Provider adapters may unwrap protected destinations, rendered bodies, credentials,
and provider references only at the external I/O boundary. Captures, logs, queue
messages, fixtures, errors, and ordinary evidence must remain allowlisted and
redacted.

Keep fake `captured` outcomes distinct from provider acceptance and delivery.
Console/fake adapters are permitted only in explicit local and test runtimes;
other unconfigured runtimes fail closed as `needs_configuration`.

Appointment email uses its own revision-bound intent and attempt aggregates. The
domain command and immutable email intent commit atomically; provider I/O runs
afterward from queue wakeups or the scheduled recovery sweep. Signed Platform
Webhooks remain an independent Booking outbox consequence.
