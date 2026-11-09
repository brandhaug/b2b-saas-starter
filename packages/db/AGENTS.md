# Database

Owns domain-organized Drizzle tables in `src/schema/`, migrations, and D1 services. Import tables from the owning `db/schema/<domain>` entry point. `src/schema.ts` assembles the complete table registry for adapter configuration and migrated-schema inspection. Stored enum vocabularies live in `src/enums.ts`, which stays Drizzle-free for auth and authorization consumers. `src/token-lifecycle.ts` is the Drizzle-free owner of the `api_tokens` lifecycle predicates (ADR 0077): `isActiveLeafToken` and its revoked/rotated/expired parts, with the SQL mirrors — admission, rotation-chain selection, the retention index — named in its doc comment.

## Migration changes

Edit the owning file in `src/schema/`, run `db:generate`, and commit schema and generated migration together. `scripts/migrate.ts`, `scripts/baseline.ts`, `./testing`, and the background pool share `migrations-fs.ts` for folder names and ordering. Use repository migration scripts to preserve those bookkeeping identities. Current Wrangler and the Vitest plugin support nested patterns but name migrations by relative SQL path; the pool adapter restores the shared folder names.

After a squash, obsolete local D1 state still names deleted migrations. Follow [local reset setup](../../docs/setup.md): Alchemy development uses `.alchemy/local` and `.alchemy/state/b2b-saas-starter/local`; the compiled E2E preview uses `packages/db/.wrangler/state/v3/d1` and the `db:migrate:local` / `db:seed` commands. Reset the store used by the failing runtime (ADR 0049).

Deploy workflows run `scripts/baseline.ts` before Alchemy to reconcile migration bookkeeping. It records a table-creating migration only when every created table exists; missing remote databases are skipped and created during deploy. It cannot apply missing schema changes, so squashes containing undeployed work cannot converge. Pre-production resets require explicit target confirmation. Customer-data deployments keep incremental migrations and follow [operations recovery](../../docs/operations.md); never destroy or reseed customer data as migration repair.

Drizzle is pinned to a prerelease in the workspace catalog. Before changing APIs, check current v1 docs and the installed driver source; stable-version examples may differ. Verify Effect D1 behavior separately from `drizzle-orm/d1`.

## Storage invariants

- `src/ids.ts` owns Drizzle-free branded API-token, webhook-endpoint and webhook-delivery identities shared by browser and server. Decode transport inputs with these schemas; construct generated identities and fixture literals explicitly. Keep brands through storage references and service contracts; form text stays untrusted until its server boundary decodes it.
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
