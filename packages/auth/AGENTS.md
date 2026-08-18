# @b2b-saas-starter/auth

## Purpose & Scope

The Better Auth instance and nothing else. This package owns the options object, the plugin list, and the plugin↔schema mapping. It holds no route handlers, no session gates, and no permission decisions.

Two runtime exports carry everything:

- `Auth` — an `effectful-better-auth` service providing `{ api, instance }`. `api` is the effectful endpoint proxy (endpoints fail `BetterAuthApiError`); `instance` is the raw Better Auth object for `handler` / `asResponse` needs. The layer requires `AuthConfig`.
- `AuthConfig` — `{ db, secret, baseURL, trustedOrigins, github }`. The app builds it from worker env (`apps/web/src/lib/auth-runtime.ts`); this package never reads `process.env` or a Cloudflare binding.

`Session` and `SessionUserRole` are the inferred session types. `SessionUserRole` exists as a **compile-time guard**: widening the plugin array drops every plugin-added field from `Session` while the endpoints keep working, a break no runtime test can see because the data is still there. Indexing the type is the assertion.

## Position in the dependency graph

`auth` and [`capabilities`](../capabilities/AGENTS.md) are **siblings**. Neither imports the other, and the rule holds in both directions: a capability that needs the plugin's write path declares a structural port and the app supplies the adapter (ADR 0051). Both import [`authz`](../authz/AGENTS.md), which sits below them.

`db` is imported twice on purpose: `@b2b-saas-starter/db/client` for the **promise-based** drizzle client, which is the only thing Better Auth's `drizzleAdapter` accepts, and `@b2b-saas-starter/db/schema` for the model mapping. Mind the name collision — `db/client` exports a _type_ `Database` (the promise client this package uses) and `db/service` exports a _class_ `Database` (the Effect-native service every capability's Live layer depends on). This package wants the former.

## Plugins

Order matters. `tanstackStartCookies()` must stay **last** so cookies set by other plugins' hooks reach the framework cookie store.

| Plugin                   | Why                                                                  |
| ------------------------ | -------------------------------------------------------------------- |
| `username()`             | username sign-in alongside the Local Auth Path                       |
| `admin({ adminRoles })`  | System Admin axis — `user.role`, ban/unban, `listUsers` for `/admin` |
| `organization({ ... })`  | Workspace membership and invitations (ADR 0051)                      |
| `tanstackStartCookies()` | bridges the session cookie into TanStack Start; **last**             |

GitHub OAuth is not a plugin: `socialProviders` is an open bag, and the `github` key is present only when both credentials are configured. An unconfigured starter gets `{}`, never a provider that exists but is disabled.

The array goes through `plugins(...)` from `effectful-better-auth`, and `makeAuthOptions` returns a single non-union object type. A bare array literal in a function body widens to a union array and silently drops plugin schema inference — `SessionUserRole` is what catches that.

## The organization plugin's mapping

The starter's domain word is **Workspace** and the plugin's is "organization". The mapping lives here and nowhere else:

- `schema.organization.modelName = 'workspaces'`, `member → 'workspaceMembers'`, `invitation → 'workspaceInvitations'`. `modelName` is the **drizzle schema export key**, not the SQL table name — the adapter resolves models with `schema[modelName]`.
- `member` and `invitation` each carry `fields: { organizationId: 'workspaceId' }`. That is the only rename needed; every other plugin field name already matches a real column, because [`packages/db`](../db/AGENTS.md) gave those three tables the plugin's camelCase shape.
- `additionalFields` on `organization`: `planId`, which is the starter's own and part of the public `Workspace` DTO, and `updatedAt`, which the plugin's organization model does not declare. Both are `input: false` — a plan change is billing's job, not a caller's. Neither belongs in `metadata`: the plugin strips unknown columns from endpoint responses, and it stringifies `metadata` itself.
- `ac: accessControl` and `roles: workspaceRoleAccess` come from [`authz`](../authz/AGENTS.md). The plugin's own endpoints and `requirePermission` read the same objects, so they cannot disagree.
- `teams: { enabled: false }`, stated rather than defaulted. `dynamicAccessControl` is absent for the same reason: both want tables the schema does not have.

## Invariants

1. **A new column on `workspaces`, `workspace_members`, or `workspace_invitations` needs an `additionalFields` entry here.** A column the plugin does not know about is stripped from every endpoint response — the write succeeds and the read comes back missing the field.
2. **Nothing reads `session.activeOrganizationId`.** The plugin declares it unconditionally and writes it on create, accept, and set-active; no option turns it off, so the column exists and `live-d1.test.ts` asserts it does. The starter resolves the workspace from the request slug through `liveWorkspaceContext`, and the slug wins because it is what the address bar shows. Two sources of truth for "which workspace" is how a user ends up looking at one workspace's URL and another's data.
3. **Roles stay static and single.** The plugin's `parseRoles` joins multiple roles into one comma-separated string in `workspace_members.role`, which the column's `enum: workspaceRoles` type does not admit. Assigning two roles would write `"admin,member"`.
4. **`new Date()` in the `additionalFields` callbacks is deliberate.** Better Auth calls them outside any Effect, so `Clock` cannot reach them; this file is the platform adapter the `effect/noGlobals` rule exempts. Without `onUpdate` the column keeps its insert value forever.

## Anti-patterns

- Don't import `@b2b-saas-starter/capabilities` from here, and don't import this package from there. Use a structural port (ADR 0051).
- Don't put a permission check here. Statements, roles, and the guard live in [`authz`](../authz/AGENTS.md); enforcement happens at the route boundary.
- Don't use the Effect-native `Database` service. `drizzleAdapter` needs promises — that is what `db/client` is for.
- Don't reintroduce a `fields` block for anything but `organizationId`. If a field name needs renaming, the schema is drifting from the plugin's conventions instead.
- Don't reorder `tanstackStartCookies()`.
- Don't regenerate the schema with `@better-auth/cli generate` and commit the output. The schema is hand-written in `schema.ts` with the house helpers; the CLI's output is a diff reference only.

## External references

- Decision record: [ADR 0051](../../docs/adr/0051-workspace-membership-on-better-auth-organization-plugin.md)
- Architecture security model: [`ARCHITECTURE.md`](../../ARCHITECTURE.md#security)
- Table shapes: [`@b2b-saas-starter/db`](../db/AGENTS.md)
- Live coverage: `src/live-auth.test.ts` — the plugin's endpoints against a real local D1.
