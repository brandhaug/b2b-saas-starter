# Complete Transactional Email Workflows

Type: task
Status: Resolved
Blocked by: 26, 30, 31

## Question

Extend the readiness seam into complete durable Appointment email behavior: controlled confirmation, reschedule, cancellation, secure-link replacement and required Shop-timezone reminders; explicit Don't Notify consequences; immutable template and destination snapshots; revision-bound invalidation; independently durable attempt evidence; callbacks, retries, dead letters, scheduled recovery, source-local delivery summaries, and Operations attention. Keep completion, No Show, External Collection, internal correction, marketing, arbitrary templates, manual sends, and false replay outside the event contract.

## Acceptance criteria

- [x] Every eligible Appointment event appends email work atomically with its domain command while provider failure cannot undo the command.
- [x] Reminder scheduling, invalidation, rescheduling, duplicate sweeps, destination correction, locale, DST, and consolidated series consequences are deterministic and idempotent.
- [x] Delivery state distinguishes pending, accepted, delivered where evidenced, failed, suppressed, and unavailable without exposing raw provider data.
- [x] Queue outage, poison work, dead letters, stale claims, callback duplication, and recovery of 1,000 committed items produce no semantic duplicates.

## Resolution

Implemented a dedicated Appointment email intent/attempt aggregate with immutable
destination, locale, template, facts, and confirmation-access snapshots. Booking
and Owner commands append revision-bound confirmation, reschedule, cancellation,
reminder, suppressed, or unavailable work in their existing D1 batch. The
background worker executes that work independently with fenced claims,
write-ahead attempts, bounded retries, verified callbacks, dead letters,
five-minute recovery, and poison-message DLQ behavior.

Secure confirmation tokens are derived only at the provider boundary from the
snapshotted access revision; neither tokens nor provider references appear in
ordinary evidence. Merchant Appointment detail exposes redacted delivery history,
and Operations messaging health exposes the open Appointment-email attention
count.
