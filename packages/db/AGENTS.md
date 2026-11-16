# Database

Owns domain-organized Drizzle tables in `src/schema/`, migrations, and D1 services. Import tables from the owning `db/schema/<domain>` entry point. `src/schema.ts` assembles the complete table registry for adapter configuration and migrated-schema inspection. Stored enum vocabularies live in `src/enums.ts`, which stays Drizzle-free for auth and authorization consumers. `src/token-lifecycle.ts` is the Drizzle-free owner of the `api_tokens` lifecycle predicates (ADR 0077): `isActiveLeafToken` and its revoked/rotated/expired parts, with the SQL mirrors — admission, rotation-chain selection, the retention index — named in its doc comment.

## Migration changes

Edit the owning file in `src/schema/`, run `db:generate` (agents follow the Drizzle Kit rules below), and commit schema and generated migration together. `scripts/migrate.ts`, `scripts/baseline.ts`, `./testing`, and the background pool share `migrations-fs.ts` for folder names and ordering. Use repository migration scripts to preserve those bookkeeping identities. Current Wrangler and the Vitest plugin support nested patterns but name migrations by relative SQL path; the pool adapter restores the shared folder names.

After a squash, obsolete local D1 state still names deleted migrations. Follow [local reset setup](../../docs/setup.md): Alchemy development uses `.alchemy/local` and `.alchemy/state/b2b-saas-starter/local`; the compiled E2E preview uses `packages/db/.wrangler/state/v3/d1` and the `db:migrate:local` / `db:seed` commands. Reset the store used by the failing runtime (ADR 0049).

Deploy workflows run `scripts/baseline.ts` before Alchemy to reconcile migration bookkeeping. It records a table-creating migration only when every created table exists; missing remote databases are skipped and created during deploy. It cannot apply missing schema changes, so squashes containing undeployed work cannot converge. Pre-production resets require explicit target confirmation. Customer-data deployments keep incremental migrations and follow [operations recovery](../../docs/operations.md); never destroy or reseed customer data as migration repair.

Drizzle is pinned to a prerelease in the workspace catalog. Before changing APIs, check current v1 docs and the installed driver source; stable-version examples may differ. Verify Effect D1 behavior separately from `drizzle-orm/d1`.

### Drizzle Kit rules

`pnpm run check:migrations` runs in `check` and CI. It fails when a snapshot names a parent no folder holds or sorts before it, when `drizzle-kit check` rejects the folder, or when `generate --explain` finds schema changes without a migration.

- Generate migrations only. Never run `drizzle-kit push` or `migrate`: both change D1 outside the `scripts/migrate.ts` bookkeeping. Never run `pull`: it reads remote D1 and writes schema files into `migrations/`.
- Agents run Drizzle Kit from this package with `--output json` and read the envelope `status`; `missing_hints` exits 2, `error` exits 1. Before writing, run `generate --explain` in text mode to read the planned SQL; JSON mode returns structured statements instead.
- Resolve `missing_hints` with `--hints '<json>'` and rerun. Choose `rename` when a column or table keeps its data under a new name; `create` drops the old one and loses its data.
- Generate warns about nothing else. A new `NOT NULL` column needs a default, or `ALTER TABLE ADD` fails on any table with rows. SQLite turns most other `ALTER`s into a table rebuild (`__new_<table>`, copy, drop, rename); review rebuilds of tables with cascading children.
- Never edit `snapshot.json` or rename migration folders; the migrator runs folders in name order. To change migrations no shared database has run, delete the newest one, or one together with every later one, and regenerate. Deleting a middle folder skips its SQL on fresh databases.
- When `check_error` reports `conflicts`, delete your branch's migration folders, merge, and regenerate. Preview D1s are discarded per PR, so a branch's migrations have not run on a shared database. Never pass `--ignore-conflicts`: the merge migration hides the conflict from `check`, and both branches' SQL still runs on fresh databases. On `migrations_outdated_error` or `check_error` with `kind: "non_latest"` after a Drizzle Kit bump, commit, run `drizzle-kit up`, and review the rewritten folder.
- Use `generate --custom --name <name>` for hand-written SQL such as triggers. Drizzle Kit does not read custom SQL, so `check` cannot see what it changes.

## Storage invariants

- `src/ids.ts` owns Drizzle-free branded identities shared by browser and server: API token, webhook endpoint, webhook delivery, workspace and user. Columns holding them declare `.$type<Brand>()`, so rows read branded and writes and `eq` filters require the brand. Decode transport inputs with these schemas; construct generated identities and fixture literals explicitly with `Brand.make`. Keep brands through storage references and service contracts; form text stays untrusted until its server boundary decodes it. Never assert a brand mid-flow.
- `WorkspaceId` and `UserId` brand a plain string, not `NonEmptyString`: published response DTOs already carry them without `minLength`, and the OpenAPI document must not change. Better Auth mints both, so plugin callbacks and responses are their boundary: `@b2b-saas-starter/auth` brands sessions (`brandSession`), account, deletion and MCP-claim hooks; plugin-owned `referenceId` on OAuth tokens and consents is a `WorkspaceId`. Request inputs (forms, queries) decode with `WorkspaceIdInput` / `UserIdInput`, which also refuse empty text; client ports type the server fn's `Encoded` input and leave branding to that decode.
- Drizzle column builders are single-use. Helpers must return fresh builders.
- Resolve `RawD1` at layer construction instead of threading the binding through application code. D1 atomicity uses `batch` with compiled statements; use `batchResults` when change counts or selected evidence are needed. Both share compilation and preserve statement order. Explicit transactions are unsupported.
- Better Auth and plugin tables use epoch seconds; starter-owned tables use ISO strings. Do not decode workspace creation time as ISO storage.
- Plugin-owned workspace tables retain camelCase columns and surrogate member IDs. `workspace_members` uses a unique `(workspaceId, userId)` index, not a composite primary key: the plugin addresses members by row ID (ADR 0051).
- `workspaces.metadata` stays plain text because the plugin serializes it. Other JSON columns use `jsonText` with their owning Effect Schema and receive objects rather than pre-serialized strings. OAuth array columns also accept the plugin adapter's serialized arrays. Codecs throw only sanitized `PersistenceDecodeError` values because Drizzle requires synchronous conversion; `orUnavailable` translates these into typed failures. Never retain rejected JSON in diagnostics.
- Columns returned by organization endpoints need matching `additionalFields` in [auth](../auth/AGENTS.md), or the plugin strips them from responses. `onboardingDismissedAt` is capability-only and excluded (ADR 0066).
- Assistant directory tombstones and reservations deliberately have no cascading parent foreign keys. Parent-deletion triggers fence retained object addresses before removing accounts or Workspaces; a create trigger requires both live parents. Session authority mirrors session evidence for accepted runs and preserves explicit revocation across natural credential expiry.
- Workspace foreign keys cascade. Deletion audits use a null workspace ID so they survive that cascade.
- Membership triggers preserve the last owner under concurrent plugin writes. `workspace_deletion_fences` permits member-first plugin teardown and blocks new billing work. Its `security_recovery` purpose is reserved for frozen-database replay of verified removals; replay clears those permits before service resumes.
- Index child foreign-key columns, reusing the leftmost prefix of an existing non-partial composite index when possible. Preserve unique and partial constraints even when another index covers their columns. Verify index changes with `EXPLAIN QUERY PLAN` against migrated local D1; assert indexed access, not an exact index name.
- D1 has no native boolean: use `integer({ mode: 'boolean' })`.

## Adapters and fixtures

Better Auth uses `drizzle(d1)` from `drizzle-orm/d1` through its direct adapter; there is no promise-client wrapper. Application Effect services use `Database`.

`src/testing.ts` provisions isolated migrated D1 databases. Keep `./testing` out of application code.

The seed lives at `scripts/seed.ts`; the Effect fixture is `packages/capabilities/src/seed-fixture.ts`. Its `insert` helper takes table objects and TS-property-keyed rows, so renames break the build.
