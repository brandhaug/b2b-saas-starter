# Complete Public Guest Booking and Confirmation

Type: task
Status: resolved
Blocked by: 28, 29

## Question

Complete the Public Site-owned guest Booking journey through effective public discovery, sole Owner-Provider binding, Service and fresh Availability selection, capability-protected Booking Sessions, atomic conflict-safe holds, Customer Details and optional note, Pay In Person review, idempotent confirmation, immutable snapshots, Customer Record association, Confirmation access, customer-policy cancellation and rescheduling, and on-demand privacy-minimal Appointment Calendar Export. Preserve the Public Site service-binding boundary, non-disclosing failures, slot-loss recovery, network freshness, and one-winner contention semantics.

## Acceptance criteria

- [x] Only the Public Site is production booking ingress; private Booking App routes and Merchant credentials remain unreachable to customers.
- [x] Confirmation atomically validates the hold, matches or creates the Customer Record, writes the Appointment snapshots, consumes the hold, creates protected Confirmation access and replay evidence, and appends notification work.
- [x] Twenty-five contenders for one final slot produce exactly one Appointment and recoverable conflicts for every loser without duplicate side effects.
- [x] Confirmation management and `.ics` export require current scoped access, reveal only customer-visible facts, and do not create a synchronization channel or persisted public artifact.

## Comments

### Resolution — 2026-08-03

Completed the Solo guest journey on the existing Public Site service-binding ingress.
The private Booking App Session contract remains capability- and cookie-protected, the
removed Provider-selection route stays unavailable to customers, and the sole active
Owner-Provider is bound automatically before Service and fresh Availability selection.

Customer Details now accept a normalized optional note with a stable length error. The
note is frozen into the Appointment Customer Details snapshot and written to the
Appointment foundation in the same confirmation batch as conservative Merchant-scoped
Customer Record matching, hold consumption, protected Confirmation access, replay
evidence, Appointment creation, and notification work.

Fixed the Live hold SQL to apply Merchant-wide Blocked Time without referencing the
removed Provider column. The D1 contract now exercises twenty-five contenders: one hold
wins, all losers receive recoverable `slot_lost`, and twenty-five simultaneous final
confirmations produce one Appointment plus twenty-four typed `conflict` results. The
test also proves exactly one Customer association, protected access grant, outbox event,
and notification-intent effect set. Confirmation compares the frozen occupied interval,
including Service buffers, and the customer flow releases a losing hold, refreshes
Availability, and returns to the existing slot-loss recovery state.

Added an on-demand RFC 5545 Appointment Calendar Export under the protected
Confirmation scope. It revalidates the current cookie credential and Appointment
membership through a typed capability on every request, exports only Service names,
Shop name/address, and current Appointment times, escapes all newline forms, folds UTF-8
content lines, uses private no-store responses, and persists no calendar artifact or
synchronization state.
