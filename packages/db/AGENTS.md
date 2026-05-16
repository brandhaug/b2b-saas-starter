# packages/db

Drizzle ORM (drizzle-orm `1.0.0-rc.2`) schema, migrations, and the shared `Database` Effect service for the Cloudflare D1 database.

## What lives here

- `src/schema.ts` — 18 tables in one file. Better Auth core (`user`, `session`, `account`, `verification`) and admin-plugin columns (e.g. `user.role`, `banned`) sit alongside starter tables: `workspaces`, `workspaceMembers`, `workspaceInvitations`, `starterModules`, `workspaceModuleStates`, `integrationConnections`, `apiTokens`, `webhookEndpoints`, `webhookDeliveries`, `implementationReports`, `reportSchedules`, `notifications`, `auditEvents`, `catalogRefreshRuns`.
- `src/service.ts` — `class Database extends Context.Service<Database, DrizzleDatabase>()` plus `layerFromD1(env.DB)`. Every capability `Live*` layer depends on this; tests use a shimmed Database layer.
- `migrations/` — `drizzle-kit` output. Generate with `bun run db:generate` after editing `schema.ts`; commit schema + migration together.

## D1 gotchas captured in the schema

- **No native boolean.** Booleans use `integer({ mode: 'boolean' })`. Don't switch to raw `integer` — capabilities read these as JS `boolean`.
- **Mixed timestamp shapes by design.** Better Auth tables store epoch-seconds in `integer` columns (its plugin contract); starter tables store ISO strings in `text` columns. Don't normalize without updating both sides — Better Auth admin plugin queries by integer.
- **JSON columns are `text` with explicit `$type`.** `metadata`, `scopes`, etc. — Drizzle parses on read; never write the raw string.
- **All FKs cascade-delete from `workspaces.id`.** Removing a workspace removes its children. Audit log preserves removed-workspace rows via `workspaceId: null` system events — keep that asymmetry.

## Seed lives outside this package

`scripts/seed.ts` (repo root, not `packages/db/src/`) is the canonical seed. It was moved out to break a workspace cycle — keep it there even if it feels like it belongs in `packages/db`. The Effect seed _fixture_ used by tests lives in `packages/capabilities/src/seed-fixture.ts`.
