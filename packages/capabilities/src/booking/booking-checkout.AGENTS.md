# Booking Checkout

`booking-checkout.ts` owns normalized unverified Customer Details, Checkout Policy
resolution and acceptance facts, person-scoped Marketing Consent facts, and the
Pay In Person checkout review boundary.

- Callers pass an already-authorized `BookingSession`; route IDs are not authority.
- Customer Details belong only to that Booking Session. Never search, merge, prefill,
  or authorize by email or phone, and never create a durable Customer record here.
- Normalize accepted phone input to E.164 and expose stable field/error codes. Localized
  customer-facing validation prose belongs in the Booking App.
- Marketing Consent is person- and channel-specific. It never gates Operational
  Notifications, which are required to deliver Booking outcomes.
- A review is confirmable only when every Booking Request is complete and the exact
  Pricing Quote and Checkout Policy disclosure/version have been accepted.
- Review facts come only from the current, unexpired Time Slot Hold and its immutable
  Booking Quote. Browser input contains Customer Details only.
- Telemetry is provider-neutral, no-op by default, gated by measurement consent, and
  unable to change or mask command outcomes.
- Checkout Path is fixed to `pay_in_person`; payment and confirmation behavior belong
  to later capabilities.
