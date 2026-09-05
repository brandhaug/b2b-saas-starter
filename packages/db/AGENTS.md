# packages/db

## Purpose & Scope

Drizzle schema, migrations, and the `Database` service for D1.

## Entry Points & Contracts

Five subpaths, no root export.

- `./schema` — one file in four ownership groups: Better Auth core, the `organization` + `sso` tables, the `jwt` + MCP OAuth tables, and the starter's own. Column helpers encode the dual timestamp dialect and return _fresh_ builders (Drizzle builders are single-use); `workspaceRef` takes the FK column name, since plugin tables spell it `workspaceId`.
- `./enums` — every stored enum vocabulary, drizzle-free so `authz` and `auth` avoid table definitions. New enums go here, not beside a table.
- `./service` — `Database` (Effect-native drizzle over `@effect/sql-d1`) and `RawD1` from `layerFromD1(env.DB)`. The driver has no transactions: atomicity is `batch(statements)`, compiling builders via `toSQL()` through the raw binding.
- `./client` — the promise client, for Better Auth's `drizzleAdapter` only.
- `./testing` (test-only) — `provisionTestD1()`: isolated local D1, all migrations applied.

## Usage Patterns

Edit `schema.ts`, run `db:generate`, commit schema and migration together (drizzle-kit folder style). `scripts/migrate.ts`, `scripts/baseline.ts`, and `./testing` share `migrations-fs.ts` for identical ordering.

After a squash a stale local D1 cannot be migrated onto, its `d1_migrations` table naming deleted migrations: delete `packages/db/.wrangler/state/v3/d1`, re-run `db:migrate:local` and `db:seed`, restart `pnpm run dev` (ADR 0049).

Deployed databases converge instead of resetting: both deploy workflows run `scripts/baseline.ts` first, recording a migration in Alchemy's `__alchemy_migrations` bookkeeping as applied only when every table it creates already exists. Alchemy keys appliedness by folder name, so without the baseline every squash rename would re-run the squashed migration and die on `CREATE TABLE`. A squash of work the deployed database never received cannot converge — the deploy fails loudly; the repair is a reset (`pnpm run destroy && pnpm run deploy`, then reseed) or keeping new tables in their own incremental migration.

## Anti-patterns

- Don't use `./client` in capabilities or `./testing` in app code, and don't thread the raw binding around; resolve `RawD1` where the layer is built.
- Don't switch back to `wrangler d1 migrations apply`: it sees only flat `migrations/*.sql` and skips folder output.

## Patterns & Pitfalls

The three workspace tables are the `organization` plugin's (ADR 0051): starter names, plugin shape (camelCase columns, epoch dates, surrogate ids).

- A new column needs an `additionalFields` entry in [`auth`](../auth/AGENTS.md), or the plugin strips it from every response. Exception: `workspaces.onboardingDismissedAt` (ADR 0066).
- `workspaces.metadata` is plain `text`, never `mode: 'json'`; the plugin stringifies and parses it itself.
- `workspace_members` uses a unique index on `(workspaceId, userId)`, not a composite PK: the plugin addresses members by row id.

D1 gotchas:

- No native boolean: `integer({ mode: 'boolean' })`. JSON columns are `text` with a `$type`, parsed on read; never write the string.
- Timestamps split by ownership, not age: Better Auth tables (core and plugin-owned) store epoch seconds, starter tables ISO strings. Reading `workspaces.createdAt` as ISO is a stale contract.
- FKs cascade from `workspaces.id`, but the audit log keeps removed-workspace rows as `workspaceId: null` system events. Keep that asymmetry.

The seed lives outside this package, at `scripts/seed.ts`; the Effect test fixture is `capabilities/src/seed-fixture.ts`. Its `insert` helper takes the table object and TS-property-keyed rows, so renames break the build.

## Dependencies & Edges

`drizzle-orm`, `@effect/sql-d1`, `effect`, `failure` (dev: `drizzle-kit`, `wrangler`). Consumed by `auth`, `authz`, `capabilities`, both workers, `scripts/seed.ts`.
