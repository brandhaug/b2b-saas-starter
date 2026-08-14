# @b2b-saas-starter/authz

## Purpose & Scope

The permission vocabulary of the starter, and the one place a permission decision is made. Statements, static roles, the API-token scope mapping, and the `requirePermission` guard live here.

It sits **below** `@b2b-saas-starter/auth` and `@b2b-saas-starter/capabilities`, which are siblings. Neither can hold this, so both import it. This package must never import either of them — the dependency is one-way, and `import/no-cycle` is not the only thing keeping it that way: the guard is deliberately usable before any capability layer is built.

Built on `createAccessControl` from `better-auth/plugins/access`, which is pure — no database, no auth instance, no plugin registration.

## The model

Four concepts, in dependency order:

1. **Statements** (`statements.ts`) — one entry per resource, listing every action it understands. `starterStatements` = the organization plugin's own five resources (`organization`, `member`, `invitation`, `team`, `ac`) plus the starter's six (`apiToken`, `webhook`, `auditLog`, `module`, `notification`, `integration`).
2. **Roles** (`roles.ts`) — `owner`, `admin`, `member`, plus the synthetic roles that API token scopes map onto.
3. **Principal** (`principal.ts`) — who is asking, and the pure `authorize(principal, request)` decision.
4. **Guard** (`guard.ts`) — `requirePermission(principal, request)`, the Effect that fails `AuthorizationDenied`.

## Invariants

1. **The plugin's default statements are not optional.** A custom role that drops `organization`, `member`, `invitation`, `team`, or `ac` breaks the organization plugin's own endpoints, not merely a starter permission. The test `retains the organization plugin defaults` guards this.
2. **One `authorize()` path for sessions and tokens.** API token scopes (`read | write | admin`) are synthetic roles over the same statements, so there is no second permission implementation to keep in step. A token holding several scopes is granted when **any one** of them covers the request.
3. **Role and scope names come from `@b2b-saas-starter/db`.** `workspaceRoleAccess` and `apiTokenScopeAccess` are `Record`s keyed by the stored enums, so adding a role or a scope to the schema without mapping it here is a type error.
4. **The guard fails closed.** A null principal is a denial (`reason: 'no_principal'`), not a pass. Trusted server-side reads — the public showcase loader, the API worker's own health check — do not call the guard at all rather than calling it with nothing.
5. **The principal is an argument, not a context service.** This package cannot see `WorkspaceContext` (it lives in `capabilities`, above), and inventing a second per-request service to mirror it would give the actor two homes. Callers resolve the actor once at the route boundary and pass it in — a session actor through `memberPrincipal`, a verified bearer token through `tokenPrincipal`.
6. **`AuthorizationDenied` is declared here, once.** `capabilities` re-exports it so consumers keep one import path and the HTTP contract keeps one class identity. Never redeclare it.

## The matrix

| Role     | Gets                                                              |
| -------- | ----------------------------------------------------------------- |
| `owner`  | every statement, including `organization:delete`                  |
| `admin`  | every statement except `organization:delete`                      |
| `member` | `ac:read`, `module:read`, `notification:read`, `integration:read` |

`member` deliberately **cannot** read the audit log or list API tokens. Both leak the workspace's security posture. The empty arrays in `memberRole` say so out loud; do not "tidy" them away.

| Token scope | Gets                                                                                  |
| ----------- | ------------------------------------------------------------------------------------- |
| `read`      | every `list` and `read` action                                                        |
| `write`     | `read` plus `apiToken:create`, `webhook:create`, `module:update`, `invitation:create` |
| `admin`     | the `owner` set, shared by reference                                                  |

The `read` scope is wider than the `member` role — it can read the audit log. That is intended: a token is minted by an owner or admin, so it carries the minter's trust, not the reader's.

The full matrix is asserted permission by permission in `src/index.test.ts`, and a separate test proves the table covers every declared statement. Add a statement and that test fails until the matrix is extended.

## Using the guard

```ts
Effect.gen(function* () {
  // apps/api handler — the principal comes from the verified bearer token
  yield* requirePermission(tokenPrincipal(verified.scopes), { apiToken: ['create'] })

  // apps/web server function — the principal comes from WorkspaceContext.actor
  yield* requirePermission(memberPrincipal(ctx.actor.role), { auditLog: ['read'] })
})
```

It composes beside `enforceRateLimit` and `enforceScope` (`apps/api/src/handlers.ts`) and requires only a `Scope`, which it uses to annotate the request's wide event on denial (`outcome: 'forbidden'`, `authReason`, `permission`).

## Anti-patterns

- Don't check a role name by hand (`if (actor.role === 'owner')`). Ask for the permission; the role table is the only place the mapping lives.
- Don't add an authorization check inside a capability. Capabilities do not check authorization — the guard, the `WorkspaceContext` layer, and `ApiTokenRegistry.verifyBearerToken` do. See [`../capabilities/AGENTS.md`](../capabilities/AGENTS.md).
- Don't grant a system admin (`user.role === 'admin'`) anything here. That is a separate axis and confers nothing inside a workspace.
- Don't reach for `dynamicAccessControl` or `teams`. Both are switched off; static roles are enough for a starter.

## External references

- Architecture security model: [`ARCHITECTURE.md`](../../ARCHITECTURE.md#authorization-model)
- Better Auth access control: `better-auth/plugins/access`, `better-auth/plugins/organization/access`
