# Complete Transactional Email Workflows

Type: task
Status:
Blocked by: 26, 30, 31

## Question

Extend the readiness seam into complete durable Appointment email behavior: controlled confirmation, reschedule, cancellation, secure-link replacement and required Shop-timezone reminders; explicit Don't Notify consequences; immutable template and destination snapshots; revision-bound invalidation; independently durable attempt evidence; callbacks, retries, dead letters, scheduled recovery, source-local delivery summaries, and Operations attention. Keep completion, No Show, External Collection, internal correction, marketing, arbitrary templates, manual sends, and false replay outside the event contract.

## Acceptance criteria

- [ ] Every eligible Appointment event appends email work atomically with its domain command while provider failure cannot undo the command.
- [ ] Reminder scheduling, invalidation, rescheduling, duplicate sweeps, destination correction, locale, DST, and consolidated series consequences are deterministic and idempotent.
- [ ] Delivery state distinguishes pending, accepted, delivered where evidenced, failed, suppressed, and unavailable without exposing raw provider data.
- [ ] Queue outage, poison work, dead letters, stale claims, callback duplication, and recovery of 1,000 committed items produce no semantic duplicates.
