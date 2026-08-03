# beesolo Production Ingress Inventory

Generated from `scripts/release-baseline/ingress.ts`. Do not edit by hand.

| Kind              | Ingress                                                             | Owning surface                                                         | Contract                                                                                           | Verification seam                                                                     |
| ----------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| route             | `https://PUBLIC_SITE_ORIGIN/**`                                     | Public Site (apps/web)                                                 | Editorial routes, Merchant public pages, and the canonical booking dispatcher                      | apps/web Playwright route-ownership suite                                             |
| route             | `https://PUBLIC_SITE_ORIGIN/:merchantSlug/booking/**`               | Booking App (apps/booking) through Public Site BOOKING service binding | Guest booking sessions, protected confirmations, waiting list, and walk-ins                        | apps/web booking-dispatch tests plus apps/booking HTTP contract tests                 |
| deferred-route    | `POST /:merchantSlug/booking/payment-callback/:provider`            | Booking App payment provider edge                                      | Compatibility-only appointment-payment callback; Pay In Person is the beesolo launch checkout path | release candidate guard plus apps/booking/src/server.test.ts                          |
| callback          | `POST /callbacks/stripe/subscriptions`                              | Solo Subscription callback edge (apps/api compatibility Worker)        | Signature-verified Stripe subscription entitlement projection                                      | apps/api/src/stripe-subscription-webhook.test.ts                                      |
| callback          | `POST /callbacks/email/transactional`                               | Transactional Email callback edge (apps/api compatibility Worker)      | Signature-verified Transactional Email delivery evidence                                           | apps/api/src/index.test.ts typed-route test plus transactional-email-callback.test.ts |
| route             | `https://MERCHANT_APP_ORIGIN/**`                                    | Merchant App (apps/merchant)                                           | Owner authentication and one-Shop product operations                                               | apps/merchant browser route and authorization suites                                  |
| route             | `https://OPERATIONS_APP_ORIGIN/**`                                  | Operations App (apps/operations)                                       | Platform-staff authentication and operational controls                                             | apps/operations browser route and runtime suites                                      |
| callback          | `GET\|POST /callbacks/meta/whatsapp`                                | Operational Messaging callback edge (apps/api compatibility Worker)    | Meta challenge and signed delivery callbacks only; not a Platform API promise                      | apps/api/src/meta-whatsapp-callback.test.ts                                           |
| callback          | `POST /callbacks/smso/:pathSecret`                                  | Operational Messaging callback edge (apps/api compatibility Worker)    | Secret-path SMSO delivery callback only; not a Platform API promise                                | apps/api/src/smso-callback.test.ts                                                    |
| deferred-route    | `https://PLATFORM_API_ORIGIN/{health,openapi.json,reference,v1/**}` | Legacy Platform API compatibility Worker (apps/api)                    | Must be absent from a beesolo launch candidate; callback extraction precedes retirement            | release candidate guard rejects this ingress kind                                     |
| queue-consumer    | `BOOKING_EVENTS_QUEUE -> apps/background`                           | Background Worker durable outbox recovery                              | Queue messages are wakeups; D1 outbox remains authoritative                                        | infra binding drift tests and background outbox tests                                 |
| scheduled-trigger | `*/5 * * * * -> apps/background`                                    | Background Worker recovery sweep                                       | Recovers committed outbox work and scheduled notification work                                     | apps/background scheduled-handler tests                                               |

## Historical compatibility identity

The following names are retained until a separately verified forward-only cutover; they are resource identity, not active product identity:

- Cloudflare resource names beginning b2b-saas-starter-
- D1 database name b2b-saas-starter
- existing @b2b-saas-starter/\* workspace package scopes
- historical decisions and migration snapshots

## Production fixture invariant evidence

These suites are executed by `bun run release:baseline`.

| Invariant                                                                                                        | Verification seam                                                      |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Merchant isolation and sole Owner-Provider binding                                                               | packages/capabilities/src/merchant-catalog/merchant-onboarding.test.ts |
| Conflict-safe holds derived from the canonical fixture                                                           | packages/capabilities/src/booking/booking-scheduling.test.ts           |
| Immutable Appointment snapshots, transactional outbox, and replay convergence derived from the canonical fixture | packages/capabilities/src/booking/booking-confirmation.test.ts         |
| Canonical-fixture network-fresh no-store reads and Public Site dispatch                                          | scripts/release-baseline/fixture-contract.test.ts                      |
