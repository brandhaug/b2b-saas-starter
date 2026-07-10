# Booking Checkout

`booking-checkout.ts` owns unverified Customer Details and the Pay In Person
checkout review boundary.

- Callers pass an already-authorized `BookingSession`; route IDs are not authority.
- Customer Details belong only to that Booking Session. Never search, merge, prefill,
  or authorize by email or phone, and never create a durable Customer record here.
- Review facts come only from the current, unexpired Time Slot Hold and its immutable
  Booking Quote. Browser input contains Customer Details only.
- Checkout Path is fixed to `pay_in_person`; payment and confirmation behavior belong
  to later capabilities.
