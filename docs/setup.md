# Setup

## Local development

Requires [Bun](https://bun.sh) >= 1.3.3.

```bash
git clone git@github.com:brandhaug/b2b-saas-starter.git
cd b2b-saas-starter
bun install
cp .env.example .env
bun run dev
```

Open <http://localhost:3071>. The `.env` defaults work out of the box — optional providers (GitHub OAuth, Stripe, Sentry, PostHog, Turnstile, email, AI) stay inactive until you fill in their variables.

## Database

Local D1 runs through Wrangler's Miniflare, no Cloudflare account needed:

```bash
bun run db:migrate:local   # apply migrations to the local D1
bun run db:seed            # deterministic seed workspace (starter-lab)
```

Seeding also creates a demo credential account so the authenticated area is reachable:

| Email                | Password                | Roles                                         |
| -------------------- | ----------------------- | --------------------------------------------- |
| `demo@starter.local` | `demo-starter-password` | System admin (`/admin`) + `starter-lab` owner |

Sign in at `/sign-in` with these credentials once the app is running against the seeded database. (The plain `bun run dev` vite server uses a workers shim without a D1 binding, so capability data comes from the in-memory seed layer and credential sign-in requires a real local D1.)

Schema changes: edit `packages/db/src/schema.ts`, then `bun run db:generate` to emit a migration.

`db:migrate:local` / `db:migrate:remote` run `packages/db/scripts/migrate.ts`, which applies drizzle-kit's folder-style migrations (`packages/db/migrations/<timestamp_name>/migration.sql`) through `wrangler d1 execute` and records them in a `d1_migrations` table so re-runs skip already-applied migrations. (Wrangler's own `d1 migrations apply` only understands flat `*.sql` files, so it cannot be used here.)

For remote migrations (`bun run db:generate` against remote metadata and `bun run db:migrate:remote`), set `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_DATABASE_ID`, and `CLOUDFLARE_D1_TOKEN` in `.env` — see `packages/db/drizzle.config.ts`.

## Deploying

Deployment is Alchemy IaC via `bun run deploy` (root `alchemy.run.ts`). Required env: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`. Everything else is optional and degrades to inactive.

See [ARCHITECTURE.md](../ARCHITECTURE.md) (Deployment & Infrastructure, Secret matrix) for the full picture, and [README.md](../README.md) for the command reference.
