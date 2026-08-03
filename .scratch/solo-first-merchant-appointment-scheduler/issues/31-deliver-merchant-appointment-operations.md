# Deliver Merchant Appointment Operations and Series

Type: task
Status: resolved
Blocked by: 28, 29

## Question

Deliver the approved responsive day ledger and complete Owner Appointment operating loop: contextual desktop and mobile composition, create and record-completed paths, edit, reschedule, cancellation, completion, No Show, outcome correction, whole-party cancellation, destination-change access revocation, immutable history, append-only External Collections, and finite weekly Appointment Series with atomic preview/materialization and cancellation of remaining Scheduled members. Every command must be Merchant-scoped, revisioned, idempotent, conflict-safe, notification-explicit, and truthful under Restricted Access without Team schedules or Provider choice.

## Acceptance criteria

- [x] Desktop and mobile implement the approved ledger-first interaction model with day ledger, seven-day strip, month picker, contextual focus, and mobile sheets.
- [x] Every operation enforces its state, time, price, overlap, party, revision, idempotency, authorization, audit, and customer-consequence contract against Live D1.
- [x] External Collections are append-only Collected or Returned operational facts, never verified Payment or revenue, with net bounds and offsetting correction.
- [x] Series create two through fifty-two independent weekly Appointments atomically and support only explicit Appointment-scoped changes plus atomic cancellation of remaining Scheduled members.

## Comments

### Resolution — 2026-08-03

Delivered the responsive ledger-first Merchant workflow, the Live D1 command and history boundary, append-only External Collections, and finite atomic Appointment Series. Series validation preserves the recurrence anchor, rejects past Scheduled members, reports both persisted and proposed-member conflicts, and requires a fresh finalized-preview acknowledgement after any draft change.

Verification completed with the repository-wide typecheck and format check, focused Live D1 command tests (8 passing), focused appointment UI tests (16 passing), Merchant production build, database migration tests, and React Doctor (97/100; two non-blocking large-component maintainability warnings). The full repository test command still includes unrelated pre-existing failures in background operational messaging, customer-directory forward migration, Merchant overlay/client-model tests, and an Operations invitation timeout; the issue 31 focused suites pass.
