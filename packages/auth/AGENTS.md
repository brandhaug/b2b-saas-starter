# @b2b-saas-starter/auth

Owns Better Auth configuration and plugin-to-schema mapping. Apps supply configuration and structural callback ports; this package does not read env, gate requests, or import capabilities.

## Contracts

- Keep `makeAuthOptions` a single non-union object type and the plugin array inside `plugins(...)`. Widening either silently loses plugin-added session fields. `SessionUserRole` guards that inference.
- `runBackground` is required and becomes `advanced.backgroundTasks.handler`; the app handles rejection. Ports retain Better Auth's callback signatures so adapters assign directly.
- `jwt` precedes `mcp`; `tanstackStartCookies` stays last so other plugins' cookies reach the framework store.
- `modelName` refers to the Drizzle schema export, not the SQL table. Map `organizationId` to `workspaceId`; put custom fields in `additionalFields`, never `metadata`. New workspace-table columns need matching entries or plugin responses omit them.
- Organization endpoints and request permission checks share [`authz`](../authz/AGENTS.md) roles. Roles stay static and single; Better Auth's comma-joined roles violate the database enum. Admin configuration uses `adminSystemRole` from `db/enums`.

## Mutation boundaries

Workspace mutations go through server functions and `CapabilityBindings` (ADR 0051). Adding `organizationClient` bypasses capability auditing. Auth and capabilities communicate through structural ports and must not import each other.

Enable `deleteUser` only with the app's `userDeleteHooks`, which protect sole-owner workspaces and restrictive foreign keys. Preserve password verification → `beforeDelete` → user deletion → `afterDelete` (ADR 0059).

SSO provisioning can assign `member` or `admin`, never `owner`. The app enforces the connection's `enabled` flag; Better Auth does not know it (ADR 0069).

## Session and OAuth pitfalls

- Workspaces resolve from the URL slug. Only MCP consent uses `activeOrganizationId`, writing and reading it within one authorization.
- MCP configuration supplies the audience-bound `/mcp` URL and a Workers-compatible transport. Issuance and refresh re-read membership and client consent ID/version from D1. `mcp:write` requires explicit consent; the API rechecks it before writes (ADR 0068).
- Keep `session.cookieCache` disabled. Caching delays revocation, serves stale `impersonatedBy`, and breaks MCP consent's write-then-read. Session reads are memoized per request instead.
- Passkey sign-in bypasses the additional TOTP step; the credential-endpoint gate does not run on passkey session creation (ADR 0056).
- Unconfigured social providers must be absent from the options (ADR 0070).
- Cloudflare bindings own rate limiting (ADR 0030). Preserve the token encryption, hashed verification identifiers, and trusted IP settings pinned in `options.test.ts`.
- Better Auth invokes `additionalFields` callbacks outside Effect; native dates there cannot use an Effect clock.

The [database schema](../db/AGENTS.md) is hand-written. Use Better Auth CLI output only as a diff reference. See [security architecture](../../ARCHITECTURE.md#security) for request enforcement.
