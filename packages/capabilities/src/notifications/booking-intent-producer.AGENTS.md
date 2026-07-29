# Booking Notification Intent Producer

This module is the sole cross-context preparation seam for Booking-owned domain
transactions that create or supersede mobile Operational Notification Intents.

- Booking supplies current, versioned Appointment facts; this module owns the
  protected destination, lifecycle envelope, controlled-fact record, route records,
  and semantic identity.
- Callers may compose the returned opaque mutations into a larger D1 batch, but must
  never construct Notifications-owned table writes themselves.
- Queue wake-ups contain only version, kind, and durable identifiers. They are never
  authoritative state.
- A Scheduled reminder is only a Notification Intent; do not mirror it into
  `scheduled_work`.
