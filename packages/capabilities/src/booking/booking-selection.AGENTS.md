# Booking Selection

`booking-selection.ts` owns the public bookable catalog projection and the sole
Owner-Provider binding, Primary Service, and ordered Additional Service state of
an already-authorized Booking Session.

- Callers pass the `BookingSession` returned by `BookingSessions.authorize`;
  raw route identifiers are not an authorization interface.
- BeeSolo automatically binds the sole eligible Owner-Provider. Historical preference
  facts remain readable by downstream scheduling and snapshot code.
- Solo catalogs auto-select their sole active default Provider on load.
- Selection validation is deliberately non-disclosing and mutations are atomic.
- Shop changes are aggregate-versioned, clear dependent Provider and Service state,
  and never restore stale client selections.
- Only active Merchant- and Shop-scoped catalog records with explicit eligibility
  enter the public projection.
- The projection carries resolved Merchant → Brand → Shop presentation facts,
  localized catalog text, palette provenance, and reconciliation reasons so later
  Booking facts can snapshot the exact server-authoritative values.
