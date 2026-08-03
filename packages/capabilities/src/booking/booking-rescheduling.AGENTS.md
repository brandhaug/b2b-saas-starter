# Booking Rescheduling

`booking-rescheduling.ts` owns purpose-bound replacement work and the atomic
Appointment version swap.

- A Reschedule Session is bound to one Merchant, Appointment, capability hash,
  and base Appointment version. It never replaces the ordinary Booking Session.
- Preparing or expiring replacement work must not mutate the Scheduled
  Appointment. Commit is the only operation that changes its current facts.
- A prepared replacement requires an exclusive Time Slot Hold, an accepted
  Pricing Quote, and exact Policy Acceptance facts.
- Price changes require an explicit settled additional collection or durable
  refund obligation reference. Never rewrite prior settlement history.
- Commit advances the Appointment version once, records immutable lifecycle
  history, invalidates obsolete pending reminders, and schedules only a reminder
  for the new version.
- Unknown and cross-Merchant access use the same typed not-found result.
