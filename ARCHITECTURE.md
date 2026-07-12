# Booking Product Architecture

```text
Customer browser ──> Public Site ──BOOKING binding──> Booking App
Merchant browser ──> Merchant App                         │
Server client ─────> Platform API                         │
                         │                                │
                         └──────── shared D1 <────────────┘
                                      │
                              durable booking_outbox
                                      │ queue wake-up / cron recovery
                                      v
                              Background Worker
                                ├─ Email
                                └─ signed Webhooks
```

## Five Workers

- `apps/web` is the unauthenticated Public Site and only production booking
  ingress. It reads published public Merchant data and forwards
  `/:merchantSlug/booking/**` without owning customer credentials.
- `apps/merchant` is the only authenticated first-party product application.
  Better Auth sessions are host-only and Merchant membership resolves the
  authorization boundary.
- `apps/booking` owns Booking Sessions, provider/service selection, availability,
  Time Slot Holds, checkout review, atomic confirmation, and Confirmation. It is
  private in production and reachable through the Public Site service binding.
- `apps/api` exposes health/reference endpoints and merchant-scoped `/v1` reads,
  API-token management, and Webhook configuration. It is not a customer booking
  channel or a first-party application data layer.
- `apps/background` claims durable outbox records, sends email and PII-free signed
  Webhooks, records delivery history, and recovers stale work every five minutes.

`packages/capabilities` is the Effect application layer shared by thin Worker
boundaries. Runtime Workers select Live D1 adapters. Seed adapters are test-only
and derive from the same clock-anchored Seed Booking Scenario used by local D1.

## Data and transaction boundary

D1 stores Better Auth records, optional platform Customer identities and sessions,
merchant-scoped booking associations, plus Merchant-owned catalog, schedule rules,
Booking Sessions/Holds, immutable Appointment snapshots, Confirmation access,
notification outbox work, Platform API tokens/Webhooks, delivery history, and
audit events. Availability and the Customer Directory are derived, not persisted.

Confirmation is one transaction: validate the active hold and idempotency key,
create one Appointment snapshot, consume the hold, create hashed Confirmation
access metadata, persist the replay result, and append outbox work. Queue
publication happens after commit and is only a wake-up. Queue, email, or Webhook
failure therefore cannot roll back or hide the Appointment; cron recovery later
reclaims durable work.

## Credential and privacy boundaries

| Credential/data            | Boundary                                                                        |
| -------------------------- | ------------------------------------------------------------------------------- |
| Merchant session cookie    | host-only Merchant App cookie; never bound to Public Site                       |
| Booking Session capability | browser cookie scoped to one Merchant booking path; only a hash persists        |
| Confirmation token         | exchanged once for an exact-path cookie; only hashes/access metadata persist    |
| Customer session cookie    | customer-only Better Auth namespace; never grants Merchant membership           |
| Provider access proof      | short-lived Booking Session/Provider-bound proof; only its hash persists        |
| Platform API token         | one Merchant and explicit scopes; plaintext disclosed once, hash persists       |
| Webhook signing secret     | plaintext disclosed once; encrypted/derived delivery material stays server-side |

Cross-Merchant reads return the same not-found shape as missing resources.
Operational logs, queue messages, Webhook payloads, cursors, and delivery history
use stable identifiers and event facts, not Customer Details or credentials.

## Deployment

`alchemy.run.ts` provisions one D1 database, the booking-events Queue, optional
Cloudflare Email binding, rate-limit bindings, and all five Workers. The Queue is
consumed by the Background Worker; its scheduled handler runs every five minutes.
`infra/topology.ts` is the canonical Worker-name/port map and
`infra/bindings.test.ts` prevents Alchemy/Wrangler drift.

Required deploy environment: `PUBLIC_SITE_ORIGIN`, `MERCHANT_APP_ORIGIN`,
`PLATFORM_API_ORIGIN`, `MERCHANT_AUTH_SECRET`, `CONFIRMATION_SIGNING_KEYS`, and
`CONFIRMATION_CURRENT_KEY_ID`. Email and observability providers are optional;
missing optional bindings degrade delivery or telemetry without blocking booking.
See [.env.example](./.env.example) and [docs/operations.md](./docs/operations.md).

## Vertical-slice boundary and accepted target

Pay Now/payment-provider state, refunds, rescheduling, reminders, analytics,
Merchant roles beyond Owner, persisted Availability, realtime transport, and
customer-write Platform API operations are outside the implemented Booking Vertical
Slice. Except for persisted Availability, realtime transport, and customer-write
Platform API operations, the accepted full-parity work is planned in the machine-readable
ledger at `apps/booking/src/parity/full-parity-manifest.ts`; planned entries do not
describe current runtime behavior.
