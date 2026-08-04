# Appointment Email Workflows

This capability owns durable essential email consequences for Appointment
confirmation, reschedule, cancellation, and the required reminder. Domain owners
prepare opaque mutations and include them in the same D1 batch as the source command;
the Background Worker only wakes and executes committed intent IDs.

- Keep email separate from mobile Notification Intents and activation-test evidence.
- Snapshot the controlled template version, locale, protected destination, source
  revision, access facts, and rendering facts when the domain command commits.
- Provider acceptance is not delivery. Only verified callback evidence may project
  `delivered`.
- Persist the attempt before external I/O. A lost response or stale submitting claim
  is `submission_unknown` and reconciliation-only, never an automatic resend.
- Terminal, suppressed, unavailable, and superseded work is not replayable. A new
  source revision is the only way to create a new semantic consequence.
- Queue messages are hints. D1 discovery recovers up to 1,000 due intents in stable
  order, and stale claim fencing prevents semantic duplicates.
- Summaries expose only masked destinations and normalized reasons. Raw provider
  references, callback bodies, rendered bodies, and destinations never enter them.
