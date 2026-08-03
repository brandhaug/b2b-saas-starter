# Booking Sessions

`booking-sessions.ts` owns anonymous, server-created Booking Session state and
capability authorization.

- The route ID is only a locator. Private access always requires the independent
  browser capability.
- Persist only the SHA-256 capability hash. The plaintext capability may leave the
  capability only through a session-specific `HttpOnly` cookie assembled by the
  Booking Worker.
- `pay_in_person` is assigned on creation and is never accepted as browser input.
- New sessions require a Published Public Booking Page. Existing valid sessions do
  not become invalid merely because the page is later Unpublished.
- Shop remains an optional customer choice. The persistence foundation normalizes a
  default Shop row before a page can be published; a missing normalized row is an
  infrastructure invariant failure, not an unpublished or customer-visible Shop
  requirement.
- Idle expiry is 30 minutes and absolute expiry is two hours. A valid capability for
  an expired or consumed session receives the safe gone result; all other failed
  private-access checks collapse to the same not-found error.
- Owner-Provider binding and Service selections are owned by the adjacent
  `BookingSelection` capability; callers must authorize here before passing the
  returned `BookingSession` to that interface.
