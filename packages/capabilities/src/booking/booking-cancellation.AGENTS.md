# Booking Cancellation

`booking-cancellation.ts` owns post-confirmation Appointment cancellation and the
durable refund obligations created by cancellation.

- Evaluate Cancellation Policy and Refund Policy independently from Appointment
  status and from provider availability.
- Cancelling one Appointment never mutates siblings. Whole-party cancellation is an
  explicit command and all eligible siblings change atomically or none do.
- Preserve lifecycle history and the exact snapshotted policy versions, reason, and
  original Settlement Allocations used to calculate each refund obligation.
- Cancellation commits before provider work. Refund obligations are idempotent,
  retryable, and reconciled from immutable Payment and Gift Card facts.
- Unknown and cross-Merchant Appointment access use the same typed not-found error.
- Keep merchant operational reads in `appointment-operations.ts`; do not add mutation
  behavior there.
