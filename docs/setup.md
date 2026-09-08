# Setup

## Local development

Requires the [Vite+ CLI](https://viteplus.dev) (`vp`), which provides the
pinned Node runtime and pnpm.

```bash
git clone git@github.com:brandhaug/b2b-saas-starter.git
cd b2b-saas-starter
vp install
cp .env.example .env
pnpm run dev
```

Open <http://localhost:3071>. The `.env` defaults support provider-light local development. Optional providers stay inactive until configured. The [optional providers guide](../apps/web/content/docs/getting-started/optional-providers.mdx) covers each provider: exact variables, where the values come from, and how to verify activation.

For customer support, configure the optional [support destinations](deploying.md)
for `/help`. With no contact configured, the page says contact information is
unavailable and still lets users copy support details.

For transactional email, complete the [delivery-event setup and smoke test](email-delivery.md)
after configuring the sender domain.

## Validation

Install Chromium once, then run the final validation command:

```bash
pnpm exec playwright install chromium
pnpm run validate
```

Validation runs `check`, build, generated Wrangler drift detection, and E2E. It
migrates and seeds the local demo database and needs process/port access for
Workers D1. E2E starts a fresh server on port 3097; set `E2E_PORT` to an unused
port when validating several worktrees concurrently.

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

Use the member account to check permission-limited pages and the owner account
to manage workspace settings.

Sign in at `/sign-in` with these credentials once the database is migrated and seeded. The dev server detects the persisted local D1 on startup and attaches it as the `DB` binding (see `apps/web/src/lib/cloudflare-workers-shim-dev.ts`), so credential sign-in and the Live capability layers work locally. Without a migrated database the shim leaves `DB` unset and the app runs provider-light on the in-memory seed layer. Restart `pnpm run dev` after the first migrate + seed so the binding attaches.

Schema changes: edit `packages/db/src/schema.ts`, then `pnpm run db:generate` to emit a migration.

To discard disposable local data after a schema reset or migration squash, stop
the dev server and rebuild local D1:

```bash
rm -rf packages/db/.wrangler/state/v3/d1
pnpm run db:migrate:local
pnpm run db:seed
```

Restart `pnpm run dev` afterwards so the dev shim re-attaches the binding.

`db:migrate:local` / `db:migrate:remote` run `packages/db/scripts/migrate.ts`, which applies drizzle-kit's folder-style migrations (`packages/db/migrations/<timestamp_name>/migration.sql`) through `wrangler d1 execute` and records them in a `d1_migrations` table so re-runs skip already-applied migrations. (Wrangler's own `d1 migrations apply` only understands flat `*.sql` files, so it cannot be used here.)

`db:generate` reads the local TypeScript schema. Remote migration commands use
Wrangler credentials (`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`, or an
authenticated Wrangler session). Drizzle Kit commands that connect directly to
remote D1 use the credentials in `packages/db/drizzle.config.ts`.

## Agent skills

The `implement` workflow is included in the repo. Install its supporting skills
globally with `pnpm run skills:setup` using Node 24 and Git.
See [shared skills](./agents/skills.md) for discovery, licenses, and updates.

## Deploying

Follow [deploying.md](deploying.md) for Alchemy, Cloudflare credentials, GitHub
Actions, and deployment verification. Before customer use, configure
[monitoring and recovery](operations.md) and complete the isolated drill.
