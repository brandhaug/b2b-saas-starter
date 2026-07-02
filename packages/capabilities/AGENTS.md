# @b2b-saas-starter/capabilities

## Purpose & Scope

Effect application layer that owns every workspace and starter use case as a service. Web server functions, the API worker, MCP tools, background workers, and tests all consume these services instead of reimplementing behavior against Drizzle.

Each capability follows the same five-part shape:

1. **Schema** — `Schema.Struct` describing the wire/UI DTO.
2. **Service class** — `Context.Service<Self, Shape>` with a stable opaque tag (`@b2b-saas-starter/capabilities/<Name>`).
3. **Seed layer** — `SeedXxx(...)`: in-memory fixture for tests and the demo workspace.
4. **Live layer** — `LiveXxx`: D1-backed via `Database` from `@b2b-saas-starter/db`.
5. **Composition** — re-exported through `layers.ts` into `SeedLayer` and `makeLiveCapabilitiesLayer(options)`.

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
├── workspace-projections.ts – named read projections composed from the services below
├── seed-fixture.ts     – in-memory fixture data
├── layers.ts           – SeedLayer + makeLiveCapabilitiesLayer composition (pure wiring)
├── module-env-overlay.ts – withModuleEnvStatus + env-module-id mapping tables
├── runtime.ts          – Effect runtime helpers (StarterEnv → layer selection)
└── index.ts            – public barrel; the only path consumers should import from
```

`StarterEnv` (`runtime.ts`) selects Seed vs Live by the `DB` binding and optionally carries `moduleConfig` — env-derived module statuses computed by the app via `@b2b-saas-starter/env` (ADR 0035). When present, `withModuleEnvStatus` (`module-env-overlay.ts`) decorates `StarterModuleCatalog` and `IntegrationSurfaces` so their reported status/`missingConfig` reflects the worker's real env (needs-config / attention / ready) instead of stored fixture or D1 state. Only env var _names_ pass through — never values. The env-module-id ↔ catalog-module-id / integration-provider mappings live beside the overlay in `module-env-overlay.ts`; env module ids without a mapping (e.g. `ai`, which has no catalog module or integration surface yet) are ignored.

`workspace-projections.ts` holds named read projections (`workspaceOverview`, `workspaceDashboard`, `workspaceSettingsSummary`, `listWorkspacesForUser`, `countModuleStatuses`) — pure compositions over the capability services with pre-computed aggregates (readiness score, unread count, per-status module tallies, per-workspace counts). They have **no Seed/Live adapters of their own** (ADR 0044 removed that god-object shape); web loaders and the REST `overview` endpoint consume them so app and Capability Interface views assemble the same data. Compute an aggregate here, not in a route handler or `useMemo`. `listWorkspacesForUser(userId)` is the "my workspaces" model: it takes no ambient `WorkspaceContext`, resolving the user's memberships via `WorkspaceMembership.listWorkspacesForUser` and scoping each per-workspace read itself.

Each capability gets a leaf intent node alongside its source file. Read it before changing the capability's contract.

| Context            | Capability                                                                  | Reads from D1 tables                                    | Status                                                          |
| ------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------- |
| catalog            | [`adoption-readiness`](src/catalog/adoption-readiness.AGENTS.md)            | (computed)                                              | live stub — returns empty trend                                 |
| catalog            | [`catalog-refresh-history`](src/catalog/catalog-refresh-history.AGENTS.md)  | `catalogRefreshRuns`                                    | full read + write                                               |
| catalog            | [`implementation-reports`](src/catalog/implementation-reports.AGENTS.md)    | `implementationReports`, `workspaces`                   | read-only                                                       |
| catalog            | [`starter-module-catalog`](src/catalog/starter-module-catalog.AGENTS.md)    | `starterModules`, `workspaceModuleStates`, `workspaces` | read-only                                                       |
| developer-platform | [`api-token-registry`](src/developer-platform/api-token-registry.AGENTS.md) | `apiTokens`, `workspaces`                               | list, create, revoke, verify bearer (audit-emitting)            |
| developer-platform | [`webhook-endpoints`](src/developer-platform/webhook-endpoints.AGENTS.md)   | `webhookEndpoints`, `webhookDeliveries`, `workspaces`   | list, create, disable, rotate secret (audit-emitting)           |
| developer-platform | [`webhook-publisher`](src/developer-platform/webhook-publisher.AGENTS.md)   | `webhookEndpoints`                                      | enqueue-only fan-out to `WEBHOOK_QUEUE` (no-op without binding) |
| governance         | [`audit-event-log`](src/governance/audit-event-log.AGENTS.md)               | `auditEvents`, `user`, `workspaces`                     | list + `record(input)` for upstream emitters                    |
| governance         | [`workspace-membership`](src/governance/workspace-membership.AGENTS.md)     | `workspaces`, `workspaceMembers`, `user`                | read-only (incl. cross-workspace `listWorkspacesForUser`)       |
| notifications      | [`integration-surfaces`](src/notifications/integration-surfaces.AGENTS.md)  | `integrationConnections`, `workspaces`                  | read-only                                                       |
| notifications      | [`notification-feed`](src/notifications/notification-feed.AGENTS.md)        | `notifications`, `workspaces`                           | read-only                                                       |

Shared error types live in [`errors.ts`](src/errors.ts): `WorkspaceNotFound` (404), `CapabilityUnavailable` (503 — every Live-layer D1/queue failure surfaces as this via `internal/unavailable.ts`, never as a defect), and `AuthorizationDenied` (403 — raised by `verifyBearerToken`). Seed fixtures live in [`seed-fixture.ts`](src/seed-fixture.ts) and are consumed by [`layers.ts`](src/layers.ts).

## Where to put a new capability

1. Pick the bounded context that already owns the closest concept; only add a new folder when you genuinely have a new context.
2. Add `src/<context>/<capability>.ts` (Schema + Service + Seed + Live).
3. Add `src/<context>/<capability>.AGENTS.md` describing the public surface, storage, and anti-patterns.
4. Wire `Seed*`/`Live*` into [`layers.ts`](src/layers.ts) — keep imports grouped by context.
5. Re-export through [`index.ts`](src/index.ts) under its context section.
6. Add a row to the table above.

## Cross-cutting invariants

1. **Per-workspace methods read the resolved workspace from `WorkspaceContext`, never from a `slug` parameter.** The slug→`Workspace` resolution happens once per request via `liveWorkspaceContext(slug)` or `seedWorkspaceContext(seedWorkspace, slug)` at the route boundary. Capability methods declare `WorkspaceContext` as an Effect requirement and read `ctx.workspace.id` internally. Callers still never see internal IDs.
2. **Capabilities don't check authorization — the `WorkspaceContext` layer and `ApiTokenRegistry.verifyBearerToken` do.** Workspace existence AND actor membership are enforced by the `WorkspaceContext` layer: `liveWorkspaceContext(slug, actor)` raises `WorkspaceNotFound` on an unknown slug, and — when an `ActorRef` (`{ userId }`) is passed — also for actors who are not members of the workspace, so a probing user cannot learn whether a workspace exists. `seedWorkspaceContext(…, actor, members)` mirrors the same semantics against the fixture members (`runtime.ts` passes `seedMembers`); `members` defaults to `[]`, so a bare `ActorRef` fails closed unless the fixture members are supplied. Callers that omit `actor` entirely (trusted server-side reads, e.g. the public showcase loader and the API worker after `verifyBearerToken`) get `actor: null`. Tests that already hold a fully resolved `Actor` inject it via `testWorkspaceContext(workspace, actor)` — no membership check, test-injection only. The one method-level carve-out is `verifyBearerToken`, which is itself the auth gate for the API worker and raises `AuthorizationDenied` (403) on bad tokens. See [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md#authorization-model).
3. **Audit-event writes go through `AuditEventLog`, not direct D1 inserts.** Mutating capabilities (`ApiTokenRegistry`, `WebhookEndpoints`) depend on `AuditEventLog` and either call `record(input)` or — for atomicity with their own write — run `batch(db, [mutation, audit.prepareRecord(input)])` so the mutation and audit row commit or roll back together on D1. The `AuditEventLog` adapter owns id generation and timestamps so format changes happen in one place. Mutations that match zero rows must skip the audit event.
4. **Seed and Live must satisfy the same `Shape`.** The `XxxShape` type is the contract; both layers must implement it identically. Tests bind `Seed*` plus `testWorkspaceContext(...)` and rely on this equivalence to exercise route logic without D1.
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
