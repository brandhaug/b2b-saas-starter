# Booking Selection

`booking-selection.ts` owns the public bookable catalog projection and the
Provider Preference, Primary Service, and ordered Additional Service state of
an already-authorized Booking Session.

- Callers pass the `BookingSession` returned by `BookingSessions.authorize`;
  raw route identifiers are not an authorization interface.
- `Any Provider` remains a distinct preference and is not assigned here.
- Solo catalogs auto-select their sole active default Provider on load.
- Selection validation is deliberately non-disclosing and mutations are atomic.
- Only active Merchant-scoped catalog records and explicit eligibility enter the
  public projection.
