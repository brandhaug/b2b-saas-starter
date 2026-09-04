# @b2b-saas-starter/authz

## Purpose & Scope

The permission vocabulary and the one place a decision is made: statements, roles, token scope mapping, `requirePermission`, `AuthorizationDenied`.

It sits **below** the siblings `auth` and `capabilities`: both import it, never the reverse.

## Entry Points & Contracts

No root export; four slices:

- `./client` — the pure half (`authorize`, principals, roles, statements), free of `effect` and the logger so browser code can ask the same question.
- `./guard` — `requirePermission`; annotates the wide event on denial, needs only `Scope`.
- `./errors` — `AuthorizationDenied` (403, never 404) and `AUTHORIZATION_DENIED_REASONS`, the closed on-the-wire reason vocabulary; widen that record, never inline a string.
- `./mcp-access-token` — the MCP OAuth claim vocabulary both workers share, plus `mcpAccessTokenPrincipal` (ADR 0068). Signature, issuer, audience and expiry are jose's, in `apps/api`.

Neither app calls the guard raw: `apps/api/src/request-guards.ts` (which also confines a token to its own workspace) and `apps/web/src/lib/server/authorize.ts` wrap it once each. Enforcement is the server withholding data and the guard refusing the mutation; a UI check is presentation.

## Anti-patterns

- Don't check a role name by hand (`actor.role === 'owner'`); ask for the permission.
- Don't pass a scope where a permission is meant (`enforcePermission('admin', slug)`); rule 2 forbids a second implementation.
- Don't grant a system admin anything here; that axis confers nothing in a workspace.
- Don't reach for `dynamicAccessControl` or `teams`; both are off.

## Patterns & Pitfalls

1. The organization plugin's default statements (`organization`, `member`, `invitation`, `team`, `ac`) are not optional; dropping one breaks its endpoints.
2. One `authorize()` path serves sessions and tokens; scopes are synthetic roles over the same statements, and a multi-scope token passes when one covers it.
3. Role and scope names come from `db/enums` via `satisfies Record<…>`, so a new stored role or scope is a type error until mapped.
4. The guard fails closed; trusted reads (showcase loader, health check) skip it rather than pass a null principal.
5. The principal is an argument, not a service: callers resolve the actor at the route boundary, as `WorkspaceContext` lives above.
6. Withheld permissions are load-bearing, each reason in its `roles.ts` doc comment: `read` scope is wider than the `member` role, and `write` never gets `apiToken:create` or an `sso` mutation (self-escalation). `src/index.test.ts` fails until a new statement is mapped.

## Dependencies & Edges

`db` (enums only), `better-auth`, `effect`. Consumed by `auth`, `capabilities`, both apps. [`ARCHITECTURE.md`](../../ARCHITECTURE.md#authorization-model); ADRs 0055, 0066, 0068, 0069.
