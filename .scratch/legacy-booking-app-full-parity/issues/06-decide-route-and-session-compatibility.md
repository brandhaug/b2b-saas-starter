# Decide Route and Session Compatibility

Type: grilling
Status: resolved
Blocked by: 01, 05, 14

## Question

What canonical TanStack routes, booking-session transitions, confirmation access rules, legacy-link adapters, redirects, and query-parameter compatibility are required to preserve every externally meaningful journey without retaining legacy API contracts?

## Answer

The target uses progressive, merchant-first canonical routes. Shop, Provider, and Service selections remain visible, shareable, and browser-navigable, while the server-side Booking Session remains authoritative for transactional state.

### Canonical appointment routes

- `/:merchantSlug/booking` — choose a Shop.
- `/:merchantSlug/booking/:shopSlug` — choose a Provider.
- `/:merchantSlug/booking/:shopSlug/:providerSlug/services` — choose a Service.
- `/:merchantSlug/booking/:shopSlug/:providerSlug/services/:serviceSlug` — selected Service and add-ons.
- `/:merchantSlug/booking/:shopSlug/:providerSlug/services/:serviceSlug/schedule` — choose date and Time Slot.
- `/:merchantSlug/booking/session/:sessionId/checkout` — transactional checkout. The internal session id is used only at this transactional boundary and grants no authority by itself.
- `/:merchantSlug/booking/confirmations/:routeId` — capability-protected confirmation and management.

`any` is the reserved canonical Provider segment for any-professional selection. Incomplete selection stages have their own routes rather than placeholder path segments. Add-ons, date, time, promotions, customer data, payment state, and checkout phase do not become ordinary path state.

Opening a selection URL creates or reconciles a Booking Session only after validating the complete catalog combination. The URL is authoritative for visible catalog intent; the Booking Session is authoritative for the Booking Party, Booking Requests, holds, quotes, acceptances, checkout, and confirmation. Invalid or unavailable combinations render explicit recovery and are never silently substituted.

For a group booking, the capability-protected session owns the active ordered Booking Request. Switching between requests changes the visible selection path to match the chosen request, but no party or request identifier is exposed in the selection URL. A copied route can recreate its visible catalog selections but cannot recover the original Booking Party without its capability.

### Session selection and authority

Selection routes carry a non-secret `booking=:routeId` query locator. Authority remains in a secure, HttpOnly, merchant-scoped capability cookie. The locator grants no access, permits independent Booking Parties in multiple tabs, and makes history restoration deterministic. If a copied URL is opened without its matching capability, it retains the catalog intent and starts a fresh session rather than exposing the original party. Internal session ids and secret tokens are not used as ordinary selection-route authority.

Navigation reconciles the active Booking Request deterministically:

- Changing Shop clears Provider, Service, add-ons, quote, schedule, and holds.
- Changing Provider clears incompatible Service/add-on selections, quote, schedule, and holds.
- Changing Service clears incompatible add-ons, quote, schedule, and holds.
- Leaving schedule alone does not immediately destroy a valid hold; changing an upstream selection does.
- Back and forward navigation apply the same reconciliation and never restore stale transactional state from client history.
- Direct deep links validate their full catalog combination before changing the session.
- Checkout is allowed only when every Booking Request is complete and all holds and the accepted quote remain valid; otherwise navigation is replaced with the earliest incomplete canonical route.
- Confirmation consumes the Booking Session and replaces checkout history with the confirmation route, preventing Back from resubmitting payment or confirmation.
- Stale concurrent writes fail with a session-version conflict and reload the latest canonical state instead of overwriting it.

An expired or abandoned session is immutable and releases holds and reservations. Selection routes remove its stale locator, create a fresh session, and may reapply only the validated Shop/Provider/Service intent visible in the URL. Time Slots, quotes, promotions, gift-card reservations, policy acceptances, Customer Details, and Payment Attempts never carry forward. Checkout shows an expiry explanation and explicit restart rather than silently creating a session. A valid locator without its capability is inaccessible, not evidence of absence. Transient failures preserve the current session and allow retry.

### Protected access

Notification links initially use `/:merchantSlug/booking/confirmations/:routeId?token=:oneTimeToken`. The server exchanges the short-lived, single-use token for a purpose-limited HttpOnly confirmation capability, then redirects with history replacement to the token-free canonical URL. Confirmation access covers only that Booking Party's snapshot and explicitly authorized commands; cancellation and rescheduling eligibility are evaluated separately. Invalid, expired, missing, or consumed access produces a neutral recovery page that does not reveal whether the resource exists. A verified Customer Account may regain access through ownership, but anonymous confirmation authority remains purpose-limited.

### Other canonical journeys

- Gift-card purchase: `/:merchantSlug/booking/:shopSlug/:providerSlug/gift-cards`, with `any` representing a Shop-scoped unassigned Gift Card.
- Gift-card receipt: `/:merchantSlug/booking/gift-card-sales/:routeId`, protected by a purpose-limited capability.
- Waiting-list offer: `/:merchantSlug/booking/waiting-list/:offerRouteId`, using the one-time-token exchange pattern.
- Walk-in landing: `/:merchantSlug/booking/:shopSlug/walk-ins`.
- Walk-in Service selection: `/:merchantSlug/booking/:shopSlug/any/services/:serviceSlug/walk-in`.
- Walk-in acknowledgment: `/:merchantSlug/booking/:shopSlug/walk-ins/:entryRouteId`, protected by a purpose-limited capability.
- Appointment rescheduling: `/:merchantSlug/booking/confirmations/:routeId/appointments/:appointmentRouteId/reschedule`; the original Appointment remains Scheduled until replacement commits.

### Compatibility and queries

Legacy public paths, identifiers, link adapters, redirects, and query syntax are not required. There will be no compatibility lookup for `/brands/*`, `/book/*`, `/gift-card/*`, `/view-reservation/*`, `/view-gift-card/*`, `/waiting-list/*`, or the legacy walk-in paths. Legacy APIs remain evidence only and do not survive as route contracts.

New routes accept a typed query allowlist:

- `booking` — non-secret Booking Session locator.
- `locale=en|es|fr` — explicit locale override persisted into the session.
- `embed=widget|google` — validated presentation context.
- Approved acquisition inputs such as `utm_*`, `gclid`, and `rwg_token`, captured once into provider-neutral attribution and removed where practical.
- Signed provider return parameters only on dedicated Payment callback routes.

Provider and Service preselection belongs in path segments. Date, time, add-ons, promotions, checkout phase, customer data, and Payment state are not accepted from arbitrary query strings. Unknown parameters are ignored and removed during canonicalization.

### Canonicalization, redirects, and failures

Slugs and reserved segments are lowercase; canonical routes have no trailing slash. Path segments are decoded, validated, and consistently re-encoded. Maintained target-side aliases for renamed entities may temporarily redirect to current slugs, but do not constitute legacy-app compatibility. Permanent redirects are limited to syntactic normalization. Entity renames, session reconciliation, capability exchange, expiry recovery, and journey transitions use temporary redirects. Automatic redirects replace history; explicit customer navigation pushes it. Redirects preserve only allowlisted queries, never guess an alternative entity, and terminate safely if a loop is detected.

Legacy blank failures are documented defects, not parity targets. The target uses explicit route-level recovery within the localized, embedding-aware booking shell: `404` for unknown routes or catalog entities, `410` for expired or permanently unavailable access, neutral not-found behavior for protected resources where existence is sensitive, `409` for stale session state, `422` for invalid catalog combinations, and retryable `503` behavior for temporary capability/provider outages. Loading visuals may match the legacy UI, but unresolved loading cannot become a permanent blank page.
