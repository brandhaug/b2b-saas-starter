# Deliver Merchant Activation and Publication

Type: task
Status: resolved
Blocked by: 26, 27

## Question

Deliver the complete resumable Solo activation journey through one-Shop Business Details, Owner-Provider confirmation, Services and automatic eligibility, Weekly Working Hours, Date Overrides, Blocked Time, Start-Time Interval, Service buffers, Minimum Notice, Booking Horizon, timezone and schedule-impact previews, Booking Policies, Transactional Email readiness, side-effect-free Preview Mode and Launch Test, and atomic first publication. Preserve explicit save states, revisions, failed browser input, derived progress, current conflict-safe Availability, subscription gates, and permanent first-activation evidence without Team, Brand-management, multi-Shop, or Provider-administration surfaces.

## Acceptance criteria

- [x] The checklist resumes at the first incomplete authoritative requirement and never relies on mutable completion flags or silent default hours.
- [x] Availability handles civil time, DST gaps and folds, overrides, blocks, buffers, notice, horizon, holds, Appointments, subscription access, and schedule-conflict previews without a persisted slot projection.
- [x] Preview Mode exercises saved production rules but creates no Appointment, Customer Record, consumed hold, or customer notification.
- [x] Publication atomically rechecks every activation fact, preserves all work on failure, and exposes the public page only while current readiness, Published intent, and subscription access permit it.

## Comments

### Resolution — 2026-08-03

Delivered the resumable Solo activation checklist as a derived projection over current
Shop, Owner-Provider, Service eligibility, explicit Weekly Working Hours, Date Override
review, Booking Policies, Transactional Email evidence, revision-bound Launch Test,
subscription access, and permanent first-activation evidence. Business Details and
confirmations use optimistic revisions; the Merchant surface retains browser input and
reports Saving, Saved, and Failed states.

Availability remains unpersisted and now applies Shop civil time, DST gaps and folds,
replacement or closed dates, exact Blocked Time, Service buffers, Start-Time Interval,
Minimum Notice, Booking Horizon, scheduled Appointments, unexpired holds, automatic
Owner-Provider eligibility, and current subscription access. Weekly hours, overrides,
blocks, and timezone changes expose Appointment-impact previews; timezone mutation is
rejected while an active hold exists and preserves exact commitment instants.

Launch Test selects a slot through the saved Live scheduling rules and persists only
revision evidence. A real D1 test proves it creates no Appointment, Customer Record,
hold, or notification outbox record. First publication uses a conditional atomic D1
batch that rechecks every activation fact and subscription access, rejects stale
configuration without changing publication, records first activation exactly once,
and supports idempotent replay. Later edits do not reopen onboarding or require another
Launch Test; ongoing public reads fail closed unless current Booking Readiness,
Published intent, and subscription access all remain true.
