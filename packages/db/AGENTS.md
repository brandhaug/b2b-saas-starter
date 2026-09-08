# Database

Owns Drizzle schema, migrations, and D1 services. Stored enum vocabularies live in `src/enums.ts`, which stays Drizzle-free for auth and authorization consumers.

## Migration changes

Change schema and generated migration together. Migration readers share `migrations-fs.ts` so deploys and tests apply the same order. Use the repository migration scripts; Wrangler's flat-file migration command skips Drizzle's folder output.

After a squash, reset obsolete local D1 state using [setup](../../docs/setup.md). Deployed databases use baseline bookkeeping before Alchemy deploys. A baseline records a migration only when all its created tables already exist; it cannot apply missing schema changes. Follow [operations](../../docs/operations.md) for recovery. Never destroy or reseed customer data as migration repair.

## Storage invariants

- Drizzle column builders are single-use. Helpers must return fresh builders.
- Resolve `RawD1` at layer construction. D1 atomicity uses `batch` with compiled statements; explicit transactions are unsupported.
- Better Auth and plugin tables use epoch timestamps; starter-owned tables use ISO strings. Do not decode workspace creation time as ISO storage.
- Plugin-owned workspace tables retain camelCase columns and surrogate member IDs. The unique workspace/user index does not replace the member primary key.
- `workspaces.metadata` stays plain text because the plugin serializes it. Starter JSON columns use typed text and receive objects rather than pre-serialized strings.
- Columns returned by organization endpoints need matching `additionalFields` in [auth](../auth/AGENTS.md). `onboardingDismissedAt` is capability-only and is excluded (ADR 0066).
- Workspace foreign keys cascade. Deletion audits use a null workspace ID so they survive that cascade.

Edit `schema.ts`, run `db:generate`, commit schema and migration together (drizzle-kit folder style). `scripts/migrate.ts`, `scripts/baseline.ts`, and `./testing` share `migrations-fs.ts` for identical ordering.

After a squash a stale local D1 cannot be migrated onto, its `d1_migrations` table naming deleted migrations: delete `packages/db/.wrangler/state/v3/d1`, re-run `db:migrate:local` and `db:seed`, restart `pnpm run dev` (ADR 0049).

Deploy workflows run `scripts/baseline.ts` before Alchemy to reconcile folder-name bookkeeping after squashes. It records table-creating migrations only when every created table exists; missing remote databases are skipped and created during deploy. Squashes containing undeployed work cannot converge. Pre-production resets require explicit target confirmation. Customer-data deployments keep incremental migrations and follow [operations recovery](../../docs/operations.md); never destroy/reseed as migration repair.

Drizzle is pinned to a prerelease in the workspace catalog. Check current v1 docs and the installed driver source before changing APIs; stable-version examples may differ. Verify Effect D1 behavior separately from `drizzle-orm/d1`.

## Anti-patterns

- Don't use `./testing` in app code, and don't thread the raw binding around; resolve `RawD1` where the layer is built. Better Auth's `drizzleAdapter` calls `drizzle(d1)` from `drizzle-orm/d1` directly — there is no promise-client wrapper to import.
- Don't switch back to `wrangler d1 migrations apply`: it sees only flat `migrations/*.sql` and skips folder output.

## Patterns & Pitfalls

The three workspace tables are the `organization` plugin's (ADR 0051): starter names, plugin shape (camelCase columns, epoch dates, surrogate ids).

- A new column needs an `additionalFields` entry in [`auth`](../auth/AGENTS.md), or the plugin strips it from every response. Exception: `workspaces.onboardingDismissedAt` (ADR 0066).
- `workspaces.metadata` is plain `text`, never `mode: 'json'`; the plugin stringifies and parses it itself.
- `workspace_members` uses a unique index on `(workspaceId, userId)`, not a composite PK: the plugin addresses members by row id.

D1 gotchas:

- Index child foreign-key columns, reusing the leftmost prefix of an existing non-partial composite index when possible. Preserve unique and partial constraints even when another index covers their columns. Verify index changes with `EXPLAIN QUERY PLAN` against migrated local D1; assert indexed access, not an exact index name.
- No native boolean: `integer({ mode: 'boolean' })`. JSON columns are `text` with a `$type`, parsed on read; never write the string.
- Timestamps split by ownership, not age: Better Auth tables (core and plugin-owned) store epoch seconds, starter tables ISO strings. Reading `workspaces.createdAt` as ISO is a stale contract.
- FKs cascade from `workspaces.id`, but the audit log keeps removed-workspace rows as `workspaceId: null` system events. Keep that asymmetry.

The seed lives outside this package, at `scripts/seed.ts`; the Effect test fixture is `capabilities/src/seed-fixture.ts`. Its `insert` helper takes the table object and TS-property-keyed rows, so renames break the build.

## Dependencies & Edges

`drizzle-orm`, `@effect/sql-d1`, `effect`, `failure` (dev: `drizzle-kit`, `wrangler`). Consumed by `auth`, `authz`, `capabilities`, both workers, `scripts/seed.ts`.
`src/testing.ts` provisions isolated migrated D1 databases and must stay out of app code. Better Auth uses its direct Drizzle adapter; application Effect services use `Database`.
