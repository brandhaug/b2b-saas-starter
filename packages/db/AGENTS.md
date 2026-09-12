# Database

Owns Drizzle schema, migrations, and D1 services. Stored enum vocabularies live in `src/enums.ts`, which stays Drizzle-free for auth and authorization consumers.

## Migration changes

Edit `schema.ts`, run `db:generate`, and commit schema and generated migration together. `scripts/migrate.ts`, `scripts/baseline.ts`, and `./testing` share `migrations-fs.ts` for identical ordering. Use repository migration scripts: `wrangler d1 migrations apply` sees only flat SQL files and skips Drizzle's folder output.

After a squash, obsolete local D1 state still names deleted migrations. Follow [local reset setup](../../docs/setup.md): delete `packages/db/.wrangler/state/v3/d1`, run `db:migrate:local` and `db:seed`, then restart `pnpm run dev` (ADR 0049).

Deploy workflows run `scripts/baseline.ts` before Alchemy to reconcile migration bookkeeping. It records a table-creating migration only when every created table exists; missing remote databases are skipped and created during deploy. It cannot apply missing schema changes, so squashes containing undeployed work cannot converge. Pre-production resets require explicit target confirmation. Customer-data deployments keep incremental migrations and follow [operations recovery](../../docs/operations.md); never destroy or reseed customer data as migration repair.

Drizzle is pinned to a prerelease in the workspace catalog. Before changing APIs, check current v1 docs and the installed driver source; stable-version examples may differ. Verify Effect D1 behavior separately from `drizzle-orm/d1`.

## Storage invariants

- Drizzle column builders are single-use. Helpers must return fresh builders.
- Resolve `RawD1` at layer construction instead of threading the binding through application code. D1 atomicity uses `batch` with compiled statements; explicit transactions are unsupported.
- Better Auth and plugin tables use epoch seconds; starter-owned tables use ISO strings. Do not decode workspace creation time as ISO storage.
- Plugin-owned workspace tables retain camelCase columns and surrogate member IDs. `workspace_members` uses a unique `(workspaceId, userId)` index, not a composite primary key: the plugin addresses members by row ID (ADR 0051).
- `workspaces.metadata` stays plain text because the plugin serializes it. Starter JSON columns use typed text and receive objects rather than pre-serialized strings.
- Columns returned by organization endpoints need matching `additionalFields` in [auth](../auth/AGENTS.md), or the plugin strips them from responses. `onboardingDismissedAt` is capability-only and excluded (ADR 0066).
- Workspace foreign keys cascade. Deletion audits use a null workspace ID so they survive that cascade.
- Index child foreign-key columns, reusing the leftmost prefix of an existing non-partial composite index when possible. Preserve unique and partial constraints even when another index covers their columns. Verify index changes with `EXPLAIN QUERY PLAN` against migrated local D1; assert indexed access, not an exact index name.
- D1 has no native boolean: use `integer({ mode: 'boolean' })`.

## Adapters and fixtures

Better Auth uses `drizzle(d1)` from `drizzle-orm/d1` through its direct adapter; there is no promise-client wrapper. Application Effect services use `Database`.

`src/testing.ts` provisions isolated migrated D1 databases. Keep `./testing` out of application code.

The seed lives at `scripts/seed.ts`; the Effect fixture is `packages/capabilities/src/seed-fixture.ts`. Its `insert` helper takes table objects and TS-property-keyed rows, so renames break the build.
