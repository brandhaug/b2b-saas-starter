# @b2b-saas-starter/capabilities

Effect application layer: every business use case is a service here. Web server functions, the API worker, MCP tools, and background workers consume these services and never touch Drizzle directly.

Each capability is Schema + `Context.Service` class + `SeedXxx` (in-memory) + `LiveXxx` (D1), composed in `layers.ts` into `SeedLayer` and `makeLiveCapabilitiesLayer`. `runtime.ts` picks Seed or Live by the presence of the `DB` binding.

## Contracts

Read the capability's adjacent `<capability>.AGENTS.md` before changing its contract.

| Context            | Capabilities                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| billing            | [`billing`](../billing/AGENTS.md), [`resource-entitlements`](../billing/src/resource-entitlements.AGENTS.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| developer-platform | [`api-token-registry`](src/developer-platform/api-token-registry.AGENTS.md), [`mcp-client-connections`](src/developer-platform/mcp-client-connections.AGENTS.md), [`webhook-endpoints`](src/developer-platform/webhook-endpoints.AGENTS.md), [`webhook-publisher`](src/developer-platform/webhook-publisher.AGENTS.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| governance         | [`account-lifecycle`](src/governance/account-lifecycle.AGENTS.md), [`account-preferences`](src/governance/account-preferences.AGENTS.md), [`audit-event-log`](src/governance/audit-event-log.AGENTS.md), [`platform-user-admin`](src/governance/platform-user-admin.AGENTS.md), [`strong-authentication`](src/governance/strong-authentication.AGENTS.md), [`turnstile-verification`](src/governance/turnstile-verification.AGENTS.md), [`workspace-export`](src/governance/workspace-export.AGENTS.md), [`workspace-invitations`](src/governance/workspace-invitations.AGENTS.md), [`workspace-lifecycle`](src/governance/workspace-lifecycle.AGENTS.md), [`workspace-suspension`](src/governance/workspace-suspension.AGENTS.md), [`workspace-membership`](src/governance/workspace-membership.AGENTS.md), [`workspace-onboarding`](src/governance/workspace-onboarding.AGENTS.md), [`workspace-sso-connections`](src/governance/workspace-sso-connections.AGENTS.md) |
| notifications      | [`notification-feed`](src/notifications/notification-feed.AGENTS.md), [`notification-preferences`](src/notifications/notification-preferences.AGENTS.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

Operator monitoring reads are documented in [operational-health](src/governance/operational-health.AGENTS.md).
Retention policy, approval and cleanup changes use [retention](src/governance/retention.AGENTS.md).
Personal account archives use [personal-data-export](src/governance/personal-data-export.AGENTS.md).

## Shared contracts

- `workspace-context.ts` resolves slugs and refuses unknown workspaces and non-members identically. Seed fails closed without fixture membership.
- `workspace-projections.ts` composes reads without its own adapters (ADR 0044). Each projection covers one permission; callers assemble and withhold segments spanning permissions.
- Import identity types from `governance/workspace-identity.ts`.
- Plugin adapters use `governance/plugin-binding-failure.ts` to distinguish refused writes from unreachable storage.
- Transactional email claims and evidence belong to [email-delivery](../email-delivery/AGENTS.md).

## Changes

Adding a capability:

Place new capabilities in the owning context. Keep one module until contract and adapters need separate consumers. Add an adjacent intent node and wire both adapters in `layers.ts`. Consumers use curated package exports, without barrels or re-export shims.

Mutating capabilities that write to D1 wrap the write in `governance/audited-mutation.ts` so mutation and audit row commit together. Contract cases (`<capability>.contract.ts`) take `expect` as an argument and run twice: the Live pass from `<capability>.live.test.ts`, the Seed pass from `index.test.ts` or the capability's own `*.test.ts`.

## Boundaries

- No `slug` parameter on per-workspace methods. Depend on `WorkspaceContext` and read `ctx.workspace`. Identity-keyed methods (invitations by id, notification preferences, account lifecycle, platform user admin, SSO resolution, background feed writers) are the exception and take their key explicitly.
- No authorization inside a capability. `WorkspaceContext` proves membership; `requirePermission` at the route boundary decides permission. `verifyBearerToken` authenticates only.
- No Live mutation without the matching Seed mutation. Tests bind Seed and would pass silently.
- No Drizzle row types on an `XxxInterface`. The schema struct is the wire contract.
- Do not replace a plugin-backed write (membership, invitations, lifecycle, user admin, account lifecycle, SSO) with a direct Drizzle write to gain atomicity with its audit row. The divergence is an accepted trade (ADR 0051); the direct write would skip plugin validation and hooks.

## Dependencies

- [`db`](../db/AGENTS.md): table shapes. [`authz`](../authz/AGENTS.md): `AuthorizationDenied`, `requirePermission`.
- [`ARCHITECTURE.md`](../../ARCHITECTURE.md#authorization-model): where capability calls are gated.

## Pitfalls

- Provider selection uses typed env bags and `select*Layer`, not Effect Config: invocation bindings select Seed/Live (`runtime.ts`) and leave unconfigured optional providers inactive.
- Every Live D1 or queue failure surfaces as `CapabilityUnavailable` (503) via `orUnavailable` from `@b2b-saas-starter/failure/capability`, never as a defect.
- Paged list reads share `internal/keyset-cursor.ts` and the `Page<T>` shape (ADR 0057). Timestamped collections page newest-first on `(createdAt, id)`; untimestamped ones forward on `id`. Unpaged reads stay for the web app's own small pages.
- Seed plugin-backed adapters read `AuditEventLog` ambiently with `Effect.serviceOption`. A harness that provides none gets no records; that is expected, not a bug.
- `auditedMutations(deps)` requires `RawD1` at layer construction; the mutations it returns carry no requirement. Zero-match mutations record no audit event. A mutation that can lose a race passes a `transition` (a SQL predicate plus the statements it gates), and resolves `false` from the write's own change count.
- D1 rejects explicit `BEGIN`, so `db.transaction()` does not work. Atomicity is `batch()` only.
