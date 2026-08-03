# Waiting List

Own Waiting List Application and Availability Offer lifecycles here. An application
may have at most one pending offer. Offer capabilities are purpose-limited secrets:
store only their hashes and return a uniform unavailable error for missing, stale, or
incorrect capabilities. Accepting an offer delegates to the narrow
`OfferBooking` port and yields a Booking Session plus Time Slot Hold, never an
Appointment.
