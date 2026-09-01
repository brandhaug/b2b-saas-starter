# Setup

## Local development

Requires the [Vite+ CLI](https://viteplus.dev) (`vp`, >= 0.3.0), which provides the
managed Node runtime (>= 24) and pnpm.

```bash
git clone git@github.com:brandhaug/b2b-saas-starter.git
cd b2b-saas-starter
vp install
cp .env.example .env
pnpm run dev
```

Open <http://localhost:3071>. The `.env` defaults work out of the box — optional providers (Stripe, Sentry, PostHog, Turnstile, email, AI) stay inactive until you fill in their variables. The [optional providers guide](../apps/web/content/docs/getting-started/optional-providers.mdx) covers each provider: exact variables, where the values come from, and how to verify activation.

## Database

Local D1 runs through Wrangler's Miniflare, no Cloudflare account needed:

```bash
pnpm run db:migrate:local  # apply migrations to the local D1
pnpm run db:seed           # deterministic seed workspace (starter-lab)
```

Seeding also creates two credential accounts so the authenticated area is reachable:

| Email                  | Password                | Roles                                         |
| ---------------------- | ----------------------- | --------------------------------------------- |
| `demo@starter.local`   | `demo-starter-password` | System admin (`/admin`) + `starter-lab` owner |
| `engineer@example.com` | `demo-starter-password` | `starter-lab` member                          |

The member account exists to make the role-gated UI visible: signed in as it, the settings page shows module state only — no API-token form, no invitations, no webhook count — and the dashboard drops the webhook delivery card, because the loader never reads what the role cannot see. The owner account shows all of it.

Sign in at `/sign-in` with these credentials once the database is migrated and seeded. The dev server detects the persisted local D1 on startup and attaches it as the `DB` binding (see `apps/web/src/lib/cloudflare-workers-shim-dev.ts`), so credential sign-in and the Live capability layers work locally. Without a migrated database the shim leaves `DB` unset and the app runs provider-light on the in-memory seed layer. Restart `pnpm run dev` after the first migrate + seed so the binding attaches.

Schema changes: edit `packages/db/src/schema.ts`, then `pnpm run db:generate` to emit a migration.

If migrating reports nothing to do but the app disagrees with the schema, your local database predates the squashed baseline (the Better Auth `organization` plugin adoption rewrote the three workspace tables and replaced three migrations with one — see [ADR 0051](./adr/0051-workspace-membership-on-better-auth-organization-plugin.md)). Drop the local state and rebuild:

```bash
rm -rf packages/db/.wrangler/state/v3/d1
pnpm run db:migrate:local
pnpm run db:seed
```

Restart `pnpm run dev` afterwards so the dev shim re-attaches the binding.

`db:migrate:local` / `db:migrate:remote` run `packages/db/scripts/migrate.ts`, which applies drizzle-kit's folder-style migrations (`packages/db/migrations/<timestamp_name>/migration.sql`) through `wrangler d1 execute` and records them in a `d1_migrations` table so re-runs skip already-applied migrations. (Wrangler's own `d1 migrations apply` only understands flat `*.sql` files, so it cannot be used here.)

For remote migrations (`pnpm run db:generate` against remote metadata and `pnpm run db:migrate:remote`), set `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_DATABASE_ID`, and `CLOUDFLARE_D1_TOKEN` in `.env` — see `packages/db/drizzle.config.ts`.

## Deploying

Deployment is Alchemy IaC via `pnpm run deploy` (root `alchemy.run.ts`). Required env: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`. Everything else is optional and degrades to inactive.

For the full walkthrough — Cloudflare token setup, the GitHub Actions `production` environment secrets, first-deploy verification, and troubleshooting — see [deploying.md](./deploying.md).

See [ARCHITECTURE.md](../ARCHITECTURE.md) (Deployment & Infrastructure, Secret matrix) for the full picture, and [README.md](../README.md) for the command reference.
