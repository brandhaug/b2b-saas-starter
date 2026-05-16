# @b2b-saas-starter/capabilities

## Purpose & Scope

Effect application layer that owns every workspace and starter use case as a service. Web server functions, the API worker, MCP tools, background workers, and tests all consume these services instead of reimplementing behavior against Drizzle.

Each capability follows the same five-part shape:

1. **Schema** — `Schema.Struct` describing the wire/UI DTO.
2. **Service class** — `Context.Service<Self, Shape>` with a stable opaque tag (`@b2b-saas-starter/capabilities/<Name>`).
3. **Seed layer** — `SeedXxx(...)`: in-memory fixture for tests and the demo workspace.
4. **Live layer** — `LiveXxx`: D1-backed via `Database` from `@b2b-saas-starter/db`.
5. **Composition** — re-exported through `layers.ts` into `SeedLayer` and `LiveCapabilitiesLayer`.

No capability holds I/O state outside the layer it returns — everything is parameterized by the `Database` service so layers can be swapped per environment.

## Source layout

Capabilities are grouped by bounded context so the package can grow without flattening into a long file list. Cross-context coupling is visible at the import path.

```
src/
├── catalog/            – starter modules, refresh history, adoption readiness, implementation reports
├── developer-platform/ – API tokens, webhook endpoints
├── governance/         – audit events, workspace membership
├── notifications/      – notification feed, integration surfaces
├── internal/           – shared crypto / id helpers
├── errors.ts           – shared typed errors
├── workspace-context.ts – per-request workspace resolution
├── seed-fixture.ts     – in-memory fixture data
├── layers.ts           – SeedLayer + LiveCapabilitiesLayer composition
├── runtime.ts          – Effect runtime helpers
└── index.ts            – public barrel; the only path consumers should import from
```

Each capability gets a leaf intent node alongside its source file. Read it before changing the capability's contract.

| Context            | Capability                                                                  | Reads from D1 tables                                    | Status                                               |
| ------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------- |
| catalog            | [`adoption-readiness`](src/catalog/adoption-readiness.AGENTS.md)            | (computed)                                              | live stub — returns empty trend                      |
| catalog            | [`catalog-refresh-history`](src/catalog/catalog-refresh-history.AGENTS.md)  | `catalogRefreshRuns`                                    | full read + write                                    |
| catalog            | [`implementation-reports`](src/catalog/implementation-reports.AGENTS.md)    | `implementationReports`, `workspaces`                   | read-only                                            |
| catalog            | [`starter-module-catalog`](src/catalog/starter-module-catalog.AGENTS.md)    | `starterModules`, `workspaceModuleStates`, `workspaces` | read-only                                            |
| developer-platform | [`api-token-registry`](src/developer-platform/api-token-registry.AGENTS.md) | `apiTokens`, `workspaces`                               | list, create, revoke, verify bearer (audit-emitting) |
| developer-platform | [`webhook-endpoints`](src/developer-platform/webhook-endpoints.AGENTS.md)   | `webhookEndpoints`, `webhookDeliveries`, `workspaces`   | read-only                                            |
| governance         | [`audit-event-log`](src/governance/audit-event-log.AGENTS.md)               | `auditEvents`, `user`, `workspaces`                     | list + `record(input)` for upstream emitters         |
| governance         | [`workspace-membership`](src/governance/workspace-membership.AGENTS.md)     | `workspaces`, `workspaceMembers`, `user`                | read-only                                            |
| notifications      | [`integration-surfaces`](src/notifications/integration-surfaces.AGENTS.md)  | `integrationConnections`, `workspaces`                  | read-only                                            |
| notifications      | [`notification-feed`](src/notifications/notification-feed.AGENTS.md)        | `notifications`, `workspaces`                           | read-only                                            |

Shared error types live in [`errors.ts`](src/errors.ts): `WorkspaceNotFound` (404), `CapabilityUnavailable` (503), and `AuthorizationDenied` (403 — raised by `verifyBearerToken`). Seed fixtures live in [`seed-fixture.ts`](src/seed-fixture.ts) and are consumed by [`layers.ts`](src/layers.ts).

## Where to put a new capability

1. Pick the bounded context that already owns the closest concept; only add a new folder when you genuinely have a new context.
2. Add `src/<context>/<capability>.ts` (Schema + Service + Seed + Live).
3. Add `src/<context>/<capability>.AGENTS.md` describing the public surface, storage, and anti-patterns.
4. Wire `Seed*`/`Live*` into [`layers.ts`](src/layers.ts) — keep imports grouped by context.
5. Re-export through [`index.ts`](src/index.ts) under its context section.
6. Add a row to the table above.

## Cross-cutting invariants

1. **Per-workspace methods read the resolved workspace from `WorkspaceContext`, never from a `slug` parameter.** The slug→`Workspace` resolution happens once per request via `liveWorkspaceContext(slug)` or `seedWorkspaceContext(seedWorkspace, slug)` at the route boundary. Capability methods declare `WorkspaceContext` as an Effect requirement and read `ctx.workspace.id` internally. Callers still never see internal IDs.
2. **Capabilities don't check authorization, except `ApiTokenRegistry.verifyBearerToken`.** Workspace existence is enforced by the `WorkspaceContext` layer (raises `WorkspaceNotFound` on unknown slug). The one carve-out is `verifyBearerToken`, which is itself the auth gate for the API worker and raises `AuthorizationDenied` (403) on bad tokens. Authorization of the actor against the workspace will be added via `WorkspaceContext.actor`. See [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md#authorization-model).
3. **Audit-event writes go through `AuditEventLog.record`, not direct D1 inserts.** Mutating capabilities (`ApiTokenRegistry`, `WebhookEndpoints`) depend on `AuditEventLog` and call `record({ workspaceId, actorUserId, eventType, targetType, targetId, metadata })`. The `AuditEventLog` adapter owns id generation and timestamps so format changes happen in one place.
4. **Seed and Live must satisfy the same `Shape`.** The `XxxShape` type is the contract; both layers must implement it identically. Tests bind `Seed*` plus `seedWorkspaceContext(...)` and rely on this equivalence to exercise route logic without D1.
5. **No barrel re-exports outside `index.ts`.** Internal files import from `./<context>/<capability>.ts` (or `../<context>/<capability>.ts` from within a context). Consumers go through `@b2b-saas-starter/capabilities`.
6. **Cross-context imports are explicit.** When a capability in one context depends on another (e.g. `developer-platform/*` → `governance/audit-event-log`), the relative path makes the seam visible. Don't paper over it with re-exports.

## Anti-patterns

- Don't take `slug: string` as a method parameter. Per-workspace methods depend on `WorkspaceContext` and read `ctx.workspace`. Cross-workspace reads belong in `listGlobal`-style methods (see `audit-event-log`).
- Don't write to D1 from a capability's Live layer without adding the matching Seed mutation. The contract is asymmetric otherwise and tests will silently pass.
- Don't widen `XxxShape` to expose Drizzle row types. The schema struct is the wire contract.
- Don't inline `db.insert(auditEvents)`. Depend on `AuditEventLog` and call `audit.record(...)`.
- Don't drop a capability into the package root because you're "not sure" which context owns it. Pick a context and add a follow-up note in the leaf AGENTS.md if the boundary is provisional.

## External references

- Database schema: [`@b2b-saas-starter/db`](../db/AGENTS.md) — the source of truth for table shapes.
- Architecture security model: [`ARCHITECTURE.md`](../../ARCHITECTURE.md#security) — covers where (and where not) capability calls are gated.
