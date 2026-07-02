# packages/db

Drizzle ORM (drizzle-orm `1.0.0-rc.4`) schema, migrations, and the shared `Database` Effect service for the Cloudflare D1 database.

## What lives here

- `src/schema.ts` — 18 tables in one file. Better Auth core (`user`, `session`, `account`, `verification`) and admin-plugin columns (e.g. `user.role`, `banned`) sit alongside starter tables: `workspaces`, `workspaceMembers`, `workspaceInvitations`, `starterModules`, `workspaceModuleStates`, `integrationConnections`, `apiTokens`, `webhookEndpoints`, `webhookDeliveries`, `implementationReports`, `reportSchedules`, `notifications`, `auditEvents`, `catalogRefreshRuns`. Shared column helpers at the top (`id`, `authTimestamps`, `isoCreatedAt`, `isoUpdatedAt`, `workspaceRef`, `workspaceRefNullable`, `workspaceIdIndex`) encode the dual timestamp dialect below — use them instead of hand-rolling the column chains, and note each returns _fresh_ builders because Drizzle column builders are single-use.
- `src/service.ts` — `class Database extends Context.Service<Database, EffectDatabase>()` plus `layerFromD1(env.DB)`. The service holds drizzle's **Effect-native** database (`drizzle-orm/effect-d1` over an `@effect/sql-d1` `D1Client`): query builders are Effects, so capabilities `yield*` them directly. Capabilities map query failures to the typed `CapabilityUnavailable` error (see `packages/capabilities/src/internal/unavailable.ts`) — don't reintroduce `Effect.orDie`/`Effect.promise` around queries. Also exports `batch(db, statements)` + `BatchStatement` (`{ toSQL(): Query }`, drizzle's own `Query` type): compiles drizzle builders via `toSQL()` and runs them through the raw `D1Database` binding's `batch()` (an implicit transaction), since the effect-d1 driver has no batch/transaction support. `batch` fails with the typed `DbBatchError` (`Schema.TaggedErrorClass`, `{ reason: string }`), exported from the barrel — callers get a tagged error, not a bare `Error`. The barrel re-exports the Effect-native database type as `EffectDatabase` (un-aliased). Every capability `Live*` layer depends on this; tests use a shimmed Database layer.
- `src/client.ts` — `createDb(d1)`, the **promise-based** `drizzle-orm/d1` client. Kept solely for Better Auth's `drizzleAdapter` (`packages/auth`), which needs promises. Don't reach for it in capabilities — use the `Database` service.
- `migrations/` — `drizzle-kit` output, one folder per migration (`<timestamp_name>/migration.sql`). Generate with `bun run db:generate` after editing `schema.ts`; commit schema + migration together.
- `scripts/migrate.ts` — applies migrations via `wrangler d1 execute` with a `d1_migrations` tracking table (`bun run db:migrate:local` / `db:migrate:remote`). Don't switch back to `wrangler d1 migrations apply`: wrangler's runner only sees flat `migrations/*.sql` files and silently skips drizzle-kit's folder-style output.

## D1 gotchas captured in the schema

- **No native boolean.** Booleans use `integer({ mode: 'boolean' })`. Don't switch to raw `integer` — capabilities read these as JS `boolean`.
- **Mixed timestamp shapes by design.** Better Auth tables store epoch-seconds in `integer` columns (its plugin contract); starter tables store ISO strings in `text` columns. Don't normalize without updating both sides — Better Auth admin plugin queries by integer.
- **JSON columns are `text` with explicit `$type`.** `metadata`, `scopes`, etc. — Drizzle parses on read; never write the raw string.
- **All FKs cascade-delete from `workspaces.id`.** Removing a workspace removes its children. Audit log preserves removed-workspace rows via `workspaceId: null` system events — keep that asymmetry.

## Seed lives outside this package

`scripts/seed.ts` (repo root, not `packages/db/src/`) is the canonical seed. It was moved out to break a workspace cycle — keep it there even if it feels like it belongs in `packages/db`. The Effect seed _fixture_ used by tests lives in `packages/capabilities/src/seed-fixture.ts`.

The seed script's `insert` helper takes the Drizzle table object (not a name string) and rows keyed by the table's **TS property names**: the SQL table/column names come from `getTableName`/`getTableColumns` and values map through each column's `mapToDriverValue` (JSON stringify, boolean → 0/1), so renaming a table or column — or typoing a key — breaks seed generation at compile time instead of drifting silently. Token hashes are produced with `hashApiToken` from `@b2b-saas-starter/capabilities` (the registry's own scheme), and the first fixture token is seeded from `SEED_API_TOKEN` so the documented credential verifies against both the Seed layer and a seeded local D1.
