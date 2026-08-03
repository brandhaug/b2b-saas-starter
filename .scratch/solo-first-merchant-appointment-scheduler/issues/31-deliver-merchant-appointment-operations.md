# Deliver Merchant Appointment Operations and Series

Type: task
Status:
Blocked by: 28, 29

## Question

Deliver the approved responsive day ledger and complete Owner Appointment operating loop: contextual desktop and mobile composition, create and record-completed paths, edit, reschedule, cancellation, completion, No Show, outcome correction, whole-party cancellation, destination-change access revocation, immutable history, append-only External Collections, and finite weekly Appointment Series with atomic preview/materialization and cancellation of remaining Scheduled members. Every command must be Merchant-scoped, revisioned, idempotent, conflict-safe, notification-explicit, and truthful under Restricted Access without Team schedules or Provider choice.

## Acceptance criteria

- [ ] Desktop and mobile implement the approved ledger-first interaction model with day ledger, seven-day strip, month picker, contextual focus, and mobile sheets.
- [ ] Every operation enforces its state, time, price, overlap, party, revision, idempotency, authorization, audit, and customer-consequence contract against Live D1.
- [ ] External Collections are append-only Collected or Returned operational facts, never verified Payment or revenue, with net bounds and offsetting correction.
- [ ] Series create two through fifty-two independent weekly Appointments atomically and support only explicit Appointment-scoped changes plus atomic cancellation of remaining Scheduled members.
