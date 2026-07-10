# Booking Scheduling

`booking-scheduling.ts` owns session-authorized Availability, Time Slot Holds,
and immutable Booking Quotes.

- Callers pass an already-authorized `BookingSession`; route IDs are not authority.
- Availability is derived from current recurring rules and selections. Generated
  Time Slots are never stored.
- A hold conditionally claims one concrete Provider interval against scheduled
  Appointments and unexpired competing holds. Any Provider remains in the quote as
  the customer's preference while `assignedProvider` records the concrete choice.
- The quote is an immutable JSON snapshot. Catalog and publication reads must not
  be used to reconstruct a held quote.
- `expiresAt` is fixed at creation plus ten minutes. Reads and Session activity do
  not update it.
