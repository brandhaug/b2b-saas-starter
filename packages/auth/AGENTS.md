# @b2b-saas-starter/auth

## Purpose & Scope

The Better Auth instance and nothing else: options, plugin list, plugin↔schema mapping. No route handlers, session gates, permission decisions, env reads.

## Entry Points & Contracts

- `makeAuthOptions(config)` returns a **single non-union object type** on purpose, and `SessionUserRole` (indexed off `Session`) is the **compile-time guard**: widening the plugin array drops plugin-added fields from `Session` while endpoints keep working, a break no test catches.
- `AuthConfig` is built by the app (`lib/auth-runtime.ts`). `runBackground` is required with no fallback: it becomes `advanced.backgroundTasks.handler` verbatim and the app owns the rejection. `socialProviders` arrives resolved and structurally typed, so this package never imports `env`.
- Ports (`ports.ts`) carry **Better Auth's own callback signature**, narrowed to what the starter reads, so an app adapter assigns straight to the option: no rename wrapper, no `async` callback, no Effect.

## Usage Patterns

**Plugin order matters:** `jwt` precedes `mcp`, and `tanstackStartCookies` stays **last** so cookies from other plugins' hooks reach the framework store. Options sit in `index.ts`; what matters outside:

- `admin` takes `adminRoles: [adminSystemRole]` from `db/enums`, never a literal `'admin'` (ADR 0054).
- `organization` takes `ac`/`roles` from [`authz`](../authz/AGENTS.md), so its endpoints and `requirePermission` read one set of objects.

**Model mapping.** `modelName` is the **drizzle schema export key**, not the SQL table name (`organization → 'workspaces'`); `fields` renames `organizationId → workspaceId`, the only rename allowed. `additionalFields` never belong in `metadata`.

**sso** (ADR 0069). `provisionedRoleOf` maps anything outside `member | admin` to `member`, so **SSO never mints `owner`**. `enabled` is starter vocabulary the plugin knows nothing of, enforced by the app; connections register fully hydrated, so a new IdP needs no env change.

**MCP OAuth** (ADR 0068). `AuthConfig.mcp` supplies the audience-bound `/mcp` URL and the outbound transport, both the app's, since Workers cannot run the Node transport. `/oauth/consent` is both post-login and consent hop, its workspace pick vouched for by `MCP_WORKSPACE_SELECTED_HEADER`; `customAccessTokenClaims` re-reads membership from D1 on every refresh.

**Account deletion.** `deleteUser` stays disabled unless the app supplies `userDeleteHooks`; without them it strands sole-owner workspaces and trips restricting FKs. The order is the design (ADR 0059): password, `beforeDelete`, user row, `afterDelete`.

## Anti-patterns

- Don't import `capabilities` here or this package there; use a structural port (ADR 0051).
- Don't wire a provider that exists-but-is-disabled; social sign-in is **absent until configured** (ADR 0070).
- Don't regenerate `db/src/schema.ts` with `@better-auth/cli generate`; that schema is hand-written, CLI output only a diff reference.

## Patterns & Pitfalls

1. **A new column on the three workspace tables needs an `additionalFields` entry here**, or the plugin strips it from every endpoint response: writes succeed, reads come back short.
2. **Nothing reads `session.activeOrganizationId` except the MCP consent flow**, which writes it with `setActive` and reads it back within one authorization; workspaces resolve from the slug.
3. **Roles stay static and single.** `parseRoles` joins multiple roles into one comma-separated `workspace_members.role`, which `enum: workspaceRoles` rejects.
4. **A passkey sign-in satisfies the two-factor requirement**: the gate is an after-hook on the credential endpoints only, and the passkey endpoint creates its session directly. Deliberate.
5. **`new Date()` in `additionalFields` callbacks is deliberate**: Better Auth calls them outside any Effect, so no `Clock` reaches them, and `effect/noGlobals` exempts this adapter.
6. **Keep the array inside `plugins(...)`.** A bare array literal widens to a union and silently drops plugin schema inference; `SessionUserRole` then fails typecheck.

## Dependencies & Edges

`auth` and [`capabilities`](../capabilities/AGENTS.md) are **siblings**: neither imports the other, and both import [`authz`](../authz/AGENTS.md) below them. `db` comes in twice: `db/client` for the promise drizzle client `drizzleAdapter` requires, and `db/schema` for the mapping.

ADRs 0051, 0054, 0056, 0059, 0064, 0067, 0068, 0069, 0070; [`ARCHITECTURE.md`](../../ARCHITECTURE.md#security); table shapes in [`db`](../db/AGENTS.md).
