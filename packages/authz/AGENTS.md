# @b2b-saas-starter/authz

## Purpose & Scope

The permission vocabulary of the starter, and the one place a permission decision is made. Statements, static roles, the API-token scope mapping, and the `requirePermission` guard live here.

It sits **below** `@b2b-saas-starter/auth` and `@b2b-saas-starter/capabilities`, which are siblings. Neither can hold this, so both import it. This package must never import either of them — the dependency is one-way, and `import/no-cycle` is not the only thing keeping it that way: the guard is deliberately usable before any capability layer is built.

Built on `createAccessControl` from `better-auth/plugins/access`, which is pure — no database, no auth instance, no plugin registration.

## The model

Four concepts, in dependency order:

1. **Statements** (`statements.ts`) — one entry per resource, listing every action it understands. `starterStatements` = the organization plugin's own five resources (`organization`, `member`, `invitation`, `team`, `ac` — Better Auth's abbreviation of "access control", kept because the plugin checks that key by name) plus the starter's eight, all full-named (`apiToken`, `webhook`, `auditLog`, `notification`, `assistant`, `mcp`, `onboarding`, `sso`).
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

| Role     | Gets                                                         |
| -------- | ------------------------------------------------------------ |
| `owner`  | every statement, including `organization:delete`             |
| `admin`  | every statement except `organization:delete`                 |
| `member` | `ac:read`, `notification:read`, `assistant:read`, `mcp:read` |

`member` deliberately **cannot** read the audit log or list API tokens. Both leak the workspace's security posture. The empty arrays in `memberRole` say so out loud; do not "tidy" them away. `onboarding:dismiss` and every `sso` action are also withheld: dismissing the onboarding checklist is a workspace-level call, and SSO connections decide how every human in the workspace authenticates — both are security posture (ADR 0054, ADR 0055).

| Token scope | Gets                                                                                 |
| ----------- | ------------------------------------------------------------------------------------ |
| `read`      | every `list` and `read` action (including `sso:list`, the sanitized connection list) |
| `write`     | `read` plus `webhook:create`, `invitation:create`                                    |
| `admin`     | the `owner` set, shared by reference                                                 |

`apiToken:create` is deliberately **not** in the `write` set. Minting is the one mutation that lets a token escalate itself: a `write` token allowed to create tokens could issue an `admin` one. It stays with the owner set, which `admin` scope reaches. The `sso` mutations stay out of every token scope for the same escalation reason — a machine credential that could rewrite how humans authenticate could lock the owners out or route them at an attacker's IdP.

The `read` scope is wider than the `member` role — it can read the audit log. That is intended: a token is minted by an owner or admin, so it carries the minter's trust, not the reader's.

The full matrix is asserted permission by permission in `src/index.test.ts`, and a separate test proves the table covers every declared statement. Add a statement and that test fails until the matrix is extended.

## Using the guard

Neither app calls the guard raw. Each wraps it once, so a route names a permission and nothing else:

- `enforcePermission(request, permission, expectedWorkspaceSlug?)` — `apps/api/src/handlers.ts`. Authenticates the bearer token via `ApiTokenRegistry.verifyBearerToken`, confines it to its own workspace, then calls the guard with `tokenPrincipal(verified.scopes)`.
- `requireWorkspacePermission(permission)` — `apps/web/src/lib/server/authorize.ts`. Reads `WorkspaceContext.actor` and calls the guard with `memberPrincipal(actor.role)`, or `null` when the context resolved no actor.

```ts
Effect.gen(function* () {
  // apps/api handler
  yield* enforcePermission(request, { apiToken: ['create'] }, params.slug)

  // apps/web server function, inside the effect handed to runWorkspaceCapabilities
  yield* requireWorkspacePermission({ apiToken: ['create'] })
})
```

The guard composes beside `enforceRateLimit` (`apps/api/src/handlers.ts`) and requires only a `Scope`, which it uses to annotate the request's wide event on denial (`outcome: 'forbidden'`, `authReason`, `permission`). The web app's request scope supplies that `Scope` through `runWorkspaceCapabilities`.

## The client entry point

`@b2b-saas-starter/authz/client` (`src/client.ts`) re-exports the pure half — `authorize`, the principals, the roles, the statements — and nothing that imports `effect` or the logger. It exists so browser code can ask the same question the guard asks: `apps/web/src/lib/permissions.ts` wraps it as `viewerCan(viewer, permission)` and the workspace UI hides or explains a control with it. Importing `./guard` from a component would pull Effect and the wide-event logger into the client bundle. There is no root entry point: the package exports only `./client`, `./errors`, `./guard` and `./roles`.

The UI check is presentation only. It stops a member being shown a form that would fail on submit; the enforcement is the server withholding the data (`whenPermitted`) and the guard refusing the mutation.

## Anti-patterns

- Don't check a role name by hand (`if (actor.role === 'owner')`). Ask for the permission; the role table is the only place the mapping lives.
- Don't add an authorization check inside a capability. Capabilities do not check authorization — the guard and the `WorkspaceContext` layer do. `ApiTokenRegistry.verifyBearerToken` authenticates a bearer token and stops there; it does not judge the scopes it reports. See [`../capabilities/AGENTS.md`](../capabilities/AGENTS.md).
- Don't hand a route a scope where it means a permission. `enforcePermission(request, 'admin', slug)` cannot exist: the scope-to-permission mapping is the role table's job, and duplicating it at a call site is the second implementation invariant 2 forbids.
- Don't grant a system admin (`user.role === 'admin'`) anything here. That is a separate axis and confers nothing inside a workspace.
- Don't reach for `dynamicAccessControl` or `teams`. Both are switched off; static roles are enough for a starter.

## External references

- Architecture security model: [`ARCHITECTURE.md`](../../ARCHITECTURE.md#authorization-model)
- Better Auth access control: `better-auth/plugins/access`, `better-auth/plugins/organization/access`
