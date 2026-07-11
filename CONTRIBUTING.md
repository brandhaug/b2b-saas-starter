# Contributing

Read [CONTEXT.md](./CONTEXT.md), [ARCHITECTURE.md](./ARCHITECTURE.md), the nearest
`AGENTS.md`, and relevant decisions in [docs/adr](./docs/adr) before changing a
Booking Product boundary.

## Local setup

```bash
bun install
cp .env.example .env
bun run db:migrate:local
bun run db:seed
bun run dev
```

The Public Site, Merchant App, Booking App, Platform API, and Background Worker
use ports 3071, 3072, 3073, 8787, and 8788. Product runtimes require persisted D1
and never fall back to Seed adapters. The Booking App port is development-only;
customer E2E traffic enters through the Public Site.

## Development loop

```bash
bun run typecheck
bun run lint
bun run format:check
bun run test
bun run test:e2e
bun run build
```

Use Bun only. Add focused tests while working, run the full suite once before
committing, and update [docs/verification.md](./docs/verification.md) if a
verification seam changes. Conventional Commits are preferred. Do not commit
plaintext Booking Session capabilities, Confirmation tokens, Platform API tokens,
Webhook secrets, Customer Details in logs/events, or local Wrangler state.

See [SECURITY.md](./SECURITY.md) for private vulnerability reporting.
