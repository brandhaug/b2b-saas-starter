# @b2b-saas-starter/capabilities

## Purpose & Scope

Effect application layer that owns every workspace and starter use case as a service. Web server functions, the API worker, MCP tools, background workers, and tests all consume these services instead of reimplementing behavior against Drizzle.

Each capability follows the same five-part shape:

1. **Schema** — `Schema.Struct` describing the wire/UI DTO.
2. **Service class** — `Context.Service<Self, Interface>` with a stable opaque tag (`@b2b-saas-starter/capabilities/<Name>`).
3. **Seed layer** — `SeedXxx(...)`: in-memory fixture for tests and the demo workspace.
4. **Live layer** — `LiveXxx`: D1-backed via `Database` from `@b2b-saas-starter/db`.
5. **Composition** — re-exported through `layers.ts` into `SeedLayer` and `makeLiveCapabilitiesLayer(options)`.

No capability holds I/O state outside the layer it returns — everything is parameterized by the `Database` service so layers can be swapped per environment.

## Source layout

Capabilities are grouped by bounded context so the package can grow without flattening into a long file list. Cross-context coupling is visible at the import path.

```
src/
├── developer-platform/ – API tokens, webhook endpoints
├── governance/         – audit events, workspace membership, workspace identity types
├── notifications/      – notification feed
├── internal/           – shared crypto / id helpers
├── errors.ts           – shared typed errors
├── workspace-context.ts – per-request workspace resolution
├── workspace-projections.ts – named read projections composed from the services below
├── seed-fixture.ts     – in-memory fixture data
├── layers.ts           – SeedLayer + makeLiveCapabilitiesLayer composition (pure wiring)
├── runtime.ts          – Effect runtime helpers (StarterEnv → layer selection)
```

`StarterEnv` (`runtime.ts`) selects Seed vs Live by the `DB` binding.

`workspace-projections.ts` holds named read projections (`workspaceOverview`, `workspaceDashboard`, `listWorkspacesForUser`) — pure compositions over the capability services with pre-computed aggregates (unread count, per-workspace counts). They have **no Seed/Live adapters of their own** (ADR 0044 removed that god-object shape); web loaders and the REST `overview` endpoint consume them so app and Capability Interface views assemble the same data. Compute an aggregate here, not in a route handler or `useMemo`. `listWorkspacesForUser(userId)` is the "my workspaces" model: it takes no ambient `WorkspaceContext`, resolving the user's memberships via `WorkspaceMembership.listWorkspacesForUser` and scoping each per-workspace read itself.

A projection covers **one** permission. `workspaceDashboard` is everything `notification:read` reaches, and webhook endpoints are deliberately not in it: `webhook:list` is a separate permission a `member` does not hold, and a projection cannot check authorization (rule 2 below). The caller reads such a segment itself and drops it when the actor may not have it — see `apps/web/src/lib/server/workspace-dashboard.ts`. The old `workspaceSettingsSummary` was removed for exactly this reason: it bundled five permissions into one read, so a member's settings page received an API-token count and a webhook count the matrix denies them. A permission-shaped payload is assembled **above** this package.

Each capability gets a leaf intent node alongside its source file. Read it before changing the capability's contract.

| Context            | Capability                                                                  | Reads from D1 tables                                  | Status                                                                     |
| ------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------- |
| developer-platform | [`api-token-registry`](src/developer-platform/api-token-registry.AGENTS.md) | `apiTokens`, `workspaces`                             | list, create, revoke, verify bearer (audit-emitting)                       |
| developer-platform | [`webhook-endpoints`](src/developer-platform/webhook-endpoints.AGENTS.md)   | `webhookEndpoints`, `webhookDeliveries`, `workspaces` | list, create, disable, rotate secret (audit-emitting)                      |
| developer-platform | [`webhook-publisher`](src/developer-platform/webhook-publisher.AGENTS.md)   | `webhookEndpoints`                                    | enqueue-only fan-out to `WEBHOOK_QUEUE` (no-op without binding)            |
| governance         | [`audit-event-log`](src/governance/audit-event-log.AGENTS.md)               | `auditEvents`, `user`, `workspaces`                   | list + `record(input)` for upstream emitters                               |
| governance         | [`workspace-invitations`](src/governance/workspace-invitations.AGENTS.md)   | `workspaceInvitations`, `workspaces`                  | reads direct; create/cancel/accept via the plugin binding                  |
| governance         | [`workspace-membership`](src/governance/workspace-membership.AGENTS.md)     | `workspaces`, `workspaceMembers`, `user`              | reads direct; add/remove/change-role via the plugin binding                |
| governance         | [`workspace-lifecycle`](src/governance/workspace-lifecycle.AGENTS.md)       | `workspaces`                                          | create/rename/delete via the plugin binding (audit-emitting)               |
| governance         | [`platform-user-admin`](src/governance/platform-user-admin.AGENTS.md)       | `user`, `workspaceMembers`                            | system-admin ban/unban + cross-workspace role via binding (audit-emitting) |
| governance         | [`turnstile-verification`](src/governance/turnstile-verification.AGENTS.md) | — (no store; calls Cloudflare `siteverify`)           | env-gated token verification (`inactive` when unconfigured)                |
| notifications      | [`notification-feed`](src/notifications/notification-feed.AGENTS.md)        | `notifications`, `workspaces`                         | read-only                                                                  |

`governance/workspace-identity.ts` is not a capability: it owns the workspace identity vocabulary (`WORKSPACE_ROLES`, `SYSTEM_ROLES`, `Workspace`, `Member`, `toMember`, `findWorkspaceMember`) so `workspace-context.ts` and `governance/workspace-membership.ts` no longer import each other. `workspace-membership.ts` depends on `WorkspaceContext` for its member reads, so the shared types and the member lookup live below both. Import identity types from this module, not from the membership capability.

Shared error types live in [`errors.ts`](src/errors.ts): `WorkspaceNotFound` (404), `CapabilityUnavailable` (503 — every Live-layer D1/queue failure surfaces as this via `internal/unavailable.ts`, never as a defect), and `MembershipChangeRejected` (409 — a membership change the workspace refuses, as against a store it cannot reach). `WorkspaceChangeRejected` (409 — same reading, naming the workspace itself). `UserAdminRejected` (409 — a system-level user change `/admin` refuses: an unknown account, a non-member role change). `AuthorizationDenied` (403 — raised by `verifyBearerToken` for an unknown token, and by `requirePermission` for a denied one) is **declared in [`@b2b-saas-starter/authz`](../authz/AGENTS.md)** and re-exported from `errors.ts`, so this package and the guard raise one class. Never redeclare it here. Seed fixtures live in [`seed-fixture.ts`](src/seed-fixture.ts) and are consumed by [`layers.ts`](src/layers.ts).

`readPluginBindingFailure` (`governance/plugin-binding-failure.ts`) is imported directly as well. It is how a rejected plugin-binding call is classified — 4xx means the workspace refused, anything else means the store is unreachable — and the app that writes a binding needs it to assert its own rejections land on the right side (`apps/web/src/lib/server/invitation-binding.test.ts`).

## Where to put a new capability

1. Pick the bounded context that already owns the closest concept; only add a new folder when you genuinely have a new context.
2. Add `src/<context>/<capability>.ts` (Schema + Service + Seed + Live).
3. Add `src/<context>/<capability>.AGENTS.md` describing the public surface, storage, and anti-patterns.
4. Wire `Seed*`/`Live*` into [`layers.ts`](src/layers.ts) — keep imports grouped by context.
5. Consumers import the capability module directly, e.g. `@b2b-saas-starter/capabilities/src/<context>/<capability>.ts` (enabled by the `./src/*` exports map).
6. Add a row to the table above.

## Cross-cutting invariants

1. **Per-workspace methods read the resolved workspace from `WorkspaceContext`, never from a `slug` parameter.** The slug→`Workspace` resolution happens once per request via `liveWorkspaceContext(slug)` or `seedWorkspaceContext(seedWorkspace, slug)` at the route boundary. Capability methods declare `WorkspaceContext` as an Effect requirement and read `ctx.workspace.id` internally. Callers still never see internal IDs.

   The exceptions are **identity-keyed** methods, which run before any single workspace has been selected and resolve one from their key instead: `WorkspaceMembership.listWorkspacesForUser(userId)`, and `WorkspaceInvitations.find` / `.accept` keyed by invitation id. The last two have no `WorkspaceContext` because they _cannot_ — the actor is not a member until the invitation makes them one, and the context layer refuses non-members by design. See [`workspace-invitations`](src/governance/workspace-invitations.AGENTS.md).

2. **Capabilities don't check authorization — the `WorkspaceContext` layer and the `requirePermission` guard do.** Workspace existence AND actor membership are enforced by the `WorkspaceContext` layer: `liveWorkspaceContext(slug, actor)` raises `WorkspaceNotFound` on an unknown slug, and — when an `ActorRef` (`{ userId }`) is passed — also for actors who are not members of the workspace, so a probing user cannot learn whether a workspace exists. `seedWorkspaceContext(…, actor, members)` mirrors the same semantics against the fixture members (`runtime.ts` passes `seedMembers`); `members` defaults to `[]`, so a bare `ActorRef` fails closed unless the fixture members are supplied. Callers that omit `actor` entirely (trusted server-side reads, e.g. the public showcase loader and the API worker after `verifyBearerToken`) get `actor: null`. Tests that already hold a fully resolved `Actor` inject it via `testWorkspaceContext(workspace, actor)` — no membership check, test-injection only.

   Whether the resolved actor may perform an action is decided one level up, by `requirePermission` from [`@b2b-saas-starter/authz`](../authz/AGENTS.md), composed at the route boundary: `requireWorkspacePermission` in `apps/web/src/lib/server/authorize.ts` and `enforcePermission` in `apps/api/src/handlers.ts`. The one method-level carve-out is `verifyBearerToken`, and it **authenticates only** — it answers which token this is and what scopes it carries, raising `AuthorizationDenied` (`invalid_token`) for an unknown or revoked one. It does not judge the scopes; the guard does. See [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md#authorization-model).

3. **Audit-event writes go through `AuditEventLog`, not direct D1 inserts.** Mutating capabilities (`ApiTokenRegistry`, `WebhookEndpoints`) depend on `AuditEventLog` and either call `record(input)` or — for atomicity with their own write — run `batch(db, [mutation, yield* audit.prepareRecord(input)])` so the mutation and audit row commit or roll back together on D1 (`prepareRecord` is effectful: it reads `Clock` for the id and timestamp). The `AuditEventLog` adapter owns id generation and timestamps so format changes happen in one place. Mutations that match zero rows must skip the audit event.

   **The exception is the plugin-backed mutations** — `WorkspaceMembership` and `WorkspaceInvitations`. Their write happens over HTTP inside the binding adapter, so it cannot be enlisted into a `batch()`, and D1 rejects an explicit `BEGIN` (Drizzle's `d1/session.js` issues a raw `begin`, so `db.transaction()` does not work either). They call `record(input)` after the write and the two can therefore diverge. This is an accepted, recorded trade (ADR 0051), not an oversight to "fix" by dropping back to direct Drizzle writes — that would skip the plugin's validation and its lifecycle hooks.

4. **Seed and Live must satisfy the same `Interface`.** The `XxxInterface` type is the contract; both layers must implement it identically. Tests bind `Seed*` plus `testWorkspaceContext(...)` and rely on this equivalence to exercise route logic without D1. Where a capability mutates, matching types are not enough — write the cases once and run them against both adapters, as `governance/workspace-membership.contract.ts` does from `index.test.ts` and `live-layers.test.ts`.
5. **No barrel files.** Internal files import from `./<context>/<capability>.ts` (or `../<context>/<capability>.ts` from within a context). Consumers import `@b2b-saas-starter/capabilities/src/<context>/<capability>.ts` directly.
6. **Cross-context imports are explicit.** When a capability in one context depends on another (e.g. `developer-platform/*` → `governance/audit-event-log`), the relative path makes the seam visible. Don't paper over it with re-exports.

## Anti-patterns

- Don't take `slug: string` as a method parameter. Per-workspace methods depend on `WorkspaceContext` and read `ctx.workspace`. Cross-workspace reads belong in `listGlobal`-style methods (see `audit-event-log`).
- Don't write to D1 from a capability's Live layer without adding the matching Seed mutation. The contract is asymmetric otherwise and tests will silently pass.
- Don't widen `XxxInterface` to expose Drizzle row types. The schema struct is the wire contract.
- Don't inline `db.insert(auditEvents)`. Depend on `AuditEventLog` and call `audit.record(...)`.
- Don't drop a capability into the package root because you're "not sure" which context owns it. Pick a context and add a follow-up note in the leaf AGENTS.md if the boundary is provisional.

## External references

- Database schema: [`@b2b-saas-starter/db`](../db/AGENTS.md) — the source of truth for table shapes.
- Architecture security model: [`ARCHITECTURE.md`](../../ARCHITECTURE.md#security) — covers where (and where not) capability calls are gated.
