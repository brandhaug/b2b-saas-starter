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

### Final persisted-buffer re-resolution — 2026-08-03

Persisted Service buffers now pass through one bounded decoder in Merchant Catalog,
Merchant Availability, and Booking Scheduling: missing values retain the launch zero
default, while malformed, fractional, non-five-minute, negative, and over-limit values
fail closed. Service duration changes now re-evaluate affected active holds and preserve
only those still valid against working hours, blocks, Appointments, and competing holds.

Scheduling owns the cross-context consequence planning for duration, buffer, and
eligibility changes; Merchant Catalog composes those prepared statements with its source
mutation in one atomic D1 batch. Final independent Standards and Spec reviews report no
remaining finding.

### Reopened after persisted-buffer review — 2026-08-03

The latest review found that Booking and Scheduling projections accepted malformed
persisted Service buffer JSON, and Service duration edits invalidated every associated
hold instead of only holds made unavailable. The issue is reopened until persisted
buffers fail closed through one shared decoder and duration changes selectively
re-evaluate affected holds.

### Reopened after final review — 2026-08-03

The final Standards pass found two Merchant Catalog gaps: eligibility replacement no
longer removed omitted associations, and Service duration/status or eligibility changes
did not append immutable Schedule Change audit facts. The issue is reopened until both
atomic behaviors pass public-seam coverage and final review.

### Final re-resolution — 2026-08-03

Restored exact atomic eligibility replacement for Inactive Services, added the typed
Active-Service Owner-eligibility lifecycle guard, and aligned Seed and Live reactivation
so the sole Owner-Provider association is restored. Service duration/status and
eligibility mutations now append authenticated, immutable Schedule Change actor, time,
and before/after facts in the same transaction as configuration and hold effects.
Public-seam coverage proves rejection, replacement, audit projection, and reactivation.
The final Standards and Spec passes report no remaining hard finding or acceptance gap.

### Reopened — 2026-08-03

Re-review found incomplete transactional publication facts, hold acquisition races
against current schedule and buffer facts, missing selective hold invalidation and
schedule-change conflict/audit behavior, a deletion-sensitive Launch Test revision,
an incomplete Preview Mode journey, and missing impact/recovery UX. The issue is
reopened until those findings are implemented and reviewed again.

### Re-resolution — 2026-08-03

Closed the reopened gaps with monotonic configuration revisions, atomic hold and
Appointment-conflict guards, selective hold invalidation for schedule, policy, Service
duration/status, and buffer edits, authenticated Owner audit attribution, Shop-calendar
Booking Horizon enforcement, persistent Schedule Conflict and change projections, and
an interactive side-effect-free Preview Mode. Publication now rejects blank legacy
Business Details, rechecks current notification and subscription evidence, and returns
step-linked recovery facts. Final parallel Standards and Spec reviews found no remaining
hard violation or substantive acceptance gap; the focused suite passes 38 tests.

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
