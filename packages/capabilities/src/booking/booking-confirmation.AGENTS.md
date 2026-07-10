# Booking Confirmation

`booking-confirmation.ts` owns the atomic boundary between an active Booking
Session and a Scheduled Appointment.

- Browser input contains no accepted booking facts. The held Booking Quote and
  Customer Details are the only source for Appointment snapshots.
- The D1 batch is the success boundary. Queue publication is a post-commit,
  best-effort wake-up carrying only the outbox ID.
- Persist Confirmation access metadata only. Bearer access is deterministically
  HMAC-derived from that metadata and the configured signing keyring.
- A consumed Session is retained for only the 24-hour identical-confirm replay.
