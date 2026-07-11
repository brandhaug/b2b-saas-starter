# Setup

## Local development

```bash
bun install
cp .env.example .env
bun run db:migrate:local
bun run db:seed
bun run dev
```

Wrangler persists local D1 under `packages/db/.wrangler/state/v3`. Migrations and
the seed command target that same location. Rerunning the deterministic seed
replaces only the canonical seeded Merchant graph.

Local origins are Public Site `http://localhost:3071`, Merchant App
`http://localhost:3072`, Booking App development server `http://localhost:3073`,
Platform API `http://localhost:8787`, and Background Worker
`http://localhost:8788`. Customer traffic and Playwright use the Public Site
origin; the Booking Worker's direct origin is not exposed in production.

## Deployment

Set Cloudflare credentials plus `PUBLIC_SITE_ORIGIN`, `MERCHANT_APP_ORIGIN`,
`PLATFORM_API_ORIGIN`, `MERCHANT_AUTH_SECRET`, `CONFIRMATION_SIGNING_KEYS`, and
`CONFIRMATION_CURRENT_KEY_ID`, then run migrations and deploy:

```bash
bun run db:migrate:remote
bun run deploy
```

`CLOUDFLARE_EMAIL_FROM` is optional. Without it, booking and Confirmation remain
available and notification outbox work records an independently recoverable email
delivery outcome. See [operations.md](./operations.md) for recovery and key
rotation.
