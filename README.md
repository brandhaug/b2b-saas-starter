# Booking Product

Cloudflare-first booking product built with five Workers, Effect v4, Drizzle on
D1, Better Auth, Alchemy, Vitest, Playwright, oxlint, oxfmt, Turbo, and Bun.

The first shipped vertical slice lets a verified Merchant Owner configure and
publish a catalog and schedule; customers can book a specific or any eligible
Provider, hold a Time Slot, choose Pay In Person, and securely revisit the
Confirmation. Merchants operate Appointments and integrations through the
Merchant App and merchant-scoped Platform API. Notifications leave the atomic
confirmation transaction through a durable D1 outbox.

## Worker boundary

| Worker            | Local port | Responsibility                                                      |
| ----------------- | ---------: | ------------------------------------------------------------------- |
| Public Site       |       3071 | Editorial pages, public Merchant pages, canonical booking ingress   |
| Merchant App      |       3072 | Better Auth and authenticated Merchant configuration/operations     |
| Booking App       |       3073 | Capability-protected customer booking and Confirmation              |
| Platform API      |       8787 | Merchant-scoped `/v1` server-to-server reads and integration config |
| Background Worker |       8788 | Durable outbox recovery, email, and Webhook delivery                |

All mutable product data is Merchant-owned in one D1 database. Customer booking
traffic reaches the Booking App through the Public Site's service binding; the
Booking App has no public production origin.

## Quick start

Requires Bun 1.3.3 or newer.

```bash
bun install
cp .env.example .env
bun run db:migrate:local
bun run db:seed
bun run dev
```

The canonical fixed-clock Seed Booking Scenario is safe to rerun and replaces
only its seeded Merchant graph. Sign in to the Merchant App with
`merchant@booking.local` / `merchant-booking-password`, or open the seeded
public page at `http://localhost:3071/mara-booking-studio`.

## Commands

```bash
bun run dev                 # all five Workers
bun run dev:web             # Public Site only
bun run dev:merchant        # Merchant App only
bun run dev:booking         # Booking App development origin only
bun run dev:api
bun run dev:background

bun run build
bun run typecheck
bun run lint
bun run format:check
bun run test                # unit, integration, and real-workerd D1 tests
bun run test:e2e            # Playwright through Public Site ingress
bun run check               # typecheck + lint + format check + tests

bun run db:generate
bun run db:migrate:local
bun run db:migrate:remote
bun run db:seed
bun run deploy
bun run destroy
```

## Repository map

```text
apps/web          Public Site and booking ingress
apps/merchant     authenticated Merchant App
apps/booking      public customer booking journey
apps/api          Platform API
apps/background   notification outbox worker
packages/capabilities  Booking Product use cases and adapters
packages/db       D1 schema, migrations, and test provisioning
packages/auth     Merchant Better Auth factory
packages/email    outbound email boundary
```

Start with [ARCHITECTURE.md](./ARCHITECTURE.md), [CONTEXT.md](./CONTEXT.md), and
[docs/verification.md](./docs/verification.md). Operational recovery is in
[docs/operations.md](./docs/operations.md); architectural decisions are in
[docs/adr](./docs/adr).

## Deferred behavior

The first slice intentionally excludes Pay Now/payment-provider state, refunds,
rescheduling, reminders, analytics, customer accounts, Merchant roles beyond
Owner, multi-location Brands/Shops, durable Customer identity, persisted
Availability, realtime transport, and a customer-write Platform API.

## License

MIT — see [LICENSE](./LICENSE).
