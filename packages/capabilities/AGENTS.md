# @b2b-saas-starter/capabilities

## Purpose & Scope

Effect application layer: every business use case is a service here. Web server functions, the API worker, MCP tools, and background workers consume these services and never touch Drizzle directly.

Each capability is Schema + `Context.Service` class + `SeedXxx` (in-memory) + `LiveXxx` (D1), composed in `layers.ts` into `SeedLayer` and `makeLiveCapabilitiesLayer`. `runtime.ts` picks Seed or Live by the presence of the `DB` binding.

## Entry Points & Contracts

Bounded contexts under `src/`: `billing/`, `developer-platform/`, `governance/`, `notifications/`. `internal/` and `testing/` are shared helpers, not contexts. Every capability has a leaf node beside its source (`<capability>.AGENTS.md`); read it before changing that contract.

| Context            | Capabilities                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| billing            | [`billing`](src/billing/billing.AGENTS.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| developer-platform | [`api-token-registry`](src/developer-platform/api-token-registry.AGENTS.md), [`mcp-client-connections`](src/developer-platform/mcp-client-connections.AGENTS.md), [`webhook-endpoints`](src/developer-platform/webhook-endpoints.AGENTS.md), [`webhook-publisher`](src/developer-platform/webhook-publisher.AGENTS.md)                                                                                                                                                                                                                                                                                                                                                                                                                       |
| governance         | [`account-lifecycle`](src/governance/account-lifecycle.AGENTS.md), [`audit-event-log`](src/governance/audit-event-log.AGENTS.md), [`platform-user-admin`](src/governance/platform-user-admin.AGENTS.md), [`turnstile-verification`](src/governance/turnstile-verification.AGENTS.md), [`workspace-export`](src/governance/workspace-export.AGENTS.md), [`workspace-invitations`](src/governance/workspace-invitations.AGENTS.md), [`workspace-lifecycle`](src/governance/workspace-lifecycle.AGENTS.md), [`workspace-membership`](src/governance/workspace-membership.AGENTS.md), [`workspace-onboarding`](src/governance/workspace-onboarding.AGENTS.md), [`workspace-sso-connections`](src/governance/workspace-sso-connections.AGENTS.md) |
| notifications      | [`notification-feed`](src/notifications/notification-feed.AGENTS.md), [`notification-preferences`](src/notifications/notification-preferences.AGENTS.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

Package-level modules that are not capabilities:

- `workspace-context.ts`: per-request slug → `Workspace` resolution. `liveWorkspaceContext(slug, actor)` raises `WorkspaceNotFound` for unknown slugs and for non-members alike, so existence never leaks. Seed mirrors it against fixture members and fails closed when none are supplied.
- `workspace-projections.ts`: named read projections (dashboard, overview, my-workspaces, onboarding progress) composed over the services. No adapters of their own (ADR 0044). One projection covers one permission; a payload spanning permissions is assembled above this package by the caller, which drops segments the actor may not read.
- `governance/workspace-identity.ts`: `Workspace`, `Member`, role tuples, `toWorkspace`. Import identity types from here, not from the membership capability.
- `errors.ts`: shared typed errors with their HTTP status. `AuthorizationDenied` is declared in [`authz`](../authz/AGENTS.md) and only re-exported here.
- `governance/plugin-binding-failure.ts`: `makeBindingCaller` and `readPluginBindingFailure` classify a rejected Better Auth plugin call (4xx = workspace refused, else store unreachable). Every plugin-backed Live adapter builds its `callBinding` from it.
- `seed-fixture.ts`: the single fixture, including the demo identity shared with `scripts/seed.ts` (root rule 8).

## Usage Patterns

Adding a capability:

1. Put it in the context that owns the closest concept. New folder only for a new context.
2. One file `src/<context>/<capability>.ts` until it passes ~300 lines or a sibling needs one part; then split into `.ts` (contract), `.seed.ts`, `.live.ts`. No barrel or re-export shim.
3. Add `<capability>.AGENTS.md`, wire both layers into `layers.ts`, add a row above.
4. Consumers import `@b2b-saas-starter/capabilities/<context>/<capability>` through the curated exports map.

Mutating capabilities that write to D1 wrap the write in `governance/audited-mutation.ts` so mutation and audit row commit together. Contract cases (`<capability>.contract.ts`) take `expect` as an argument and run once against Seed and once against Live from the `.live.test.ts`.

## Anti-patterns

- No `slug` parameter on per-workspace methods. Depend on `WorkspaceContext` and read `ctx.workspace`. Identity-keyed methods (invitations by id, notification preferences, account lifecycle, platform user admin, SSO resolution, background feed writers) are the exception and take their key explicitly.
- No authorization inside a capability. `WorkspaceContext` proves membership; `requirePermission` at the route boundary decides permission. `verifyBearerToken` authenticates only.
- No direct `db.insert(auditEvents)`. Depend on `AuditEventLog`.
- No Live mutation without the matching Seed mutation. Tests bind Seed and would pass silently.
- No Drizzle row types on an `XxxInterface`. The schema struct is the wire contract.
- Do not replace a plugin-backed write (membership, invitations, lifecycle, user admin, account lifecycle, SSO) with a direct Drizzle write to gain atomicity with its audit row. The divergence is an accepted trade (ADR 0051); the direct write would skip plugin validation and hooks.
- No `./src/*` deep imports (`starter/no-deep-workspace-imports`).

## Dependencies & Edges

- [`db`](../db/AGENTS.md): table shapes. [`authz`](../authz/AGENTS.md): `AuthorizationDenied`, `requirePermission`.
- [`ARCHITECTURE.md`](../../ARCHITECTURE.md#authorization-model): where capability calls are gated.
- ADRs: 0044 (no god-object projections), 0051 (plugin-backed writes), 0057 (keyset paging), 0061 (identity-keyed notifications), 0066 (derived onboarding checklist).

## Patterns & Pitfalls

- Every Live D1 or queue failure surfaces as `CapabilityUnavailable` (503) via `internal/unavailable.ts`, never as a defect.
- Paged list reads share `internal/keyset-cursor.ts` and the `Page<T>` shape (ADR 0057). Timestamped collections page newest-first on `(createdAt, id)`; untimestamped ones forward on `id`. Unpaged reads stay for the web app's own small pages.
- Seed plugin-backed adapters read `AuditEventLog` ambiently with `Effect.serviceOption`. A harness that provides none gets no records; that is expected, not a bug.
- `auditedMutations(deps)` requires `RawD1` at layer construction; the mutations it returns carry no requirement. Zero-match mutations record no audit event.
- D1 rejects explicit `BEGIN`, so `db.transaction()` does not work. Atomicity is `batch()` only.
