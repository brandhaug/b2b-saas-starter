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
├── billing/            – plan catalog + entitlement gate, Billing service, Stripe adapter
├── developer-platform/ – API tokens, webhook endpoints
├── governance/         – audit events, workspace membership, workspace identity types, workspace export
├── notifications/      – notification feed, notification preferences, the instant-email queue port
├── internal/           – shared crypto / id / literal-tuple helpers, the keyset-cursor codec every paged list read shares (`internal/keyset-cursor.ts`, exported as `./internal/keyset-cursor`), and its SQL half — the cursor resume predicate Live adapters share (`internal/keyset-query.ts`)
=======
├── notifications/      – notification feed, notification preferences, the instant-email queue port

├── testing/            – `live-harness.ts`: the provisioned-D1 fixture and fake plugin bindings every `*.live.test.ts` imports
├── errors.ts           – shared typed errors
├── workspace-context.ts – per-request workspace resolution
├── workspace-projections.ts – named read projections composed from the services below
├── seed-fixture.ts     – in-memory fixture data
├── layers.ts           – SeedLayer + makeLiveCapabilitiesLayer composition (pure wiring)
├── runtime.ts          – Effect runtime helpers (StarterEnv → layer selection)
```

`StarterEnv` (`runtime.ts`) selects Seed vs Live by the `DB` binding.

`workspace-projections.ts` holds named read projections (`workspaceOverview`, `workspaceDashboard`, `listWorkspacesForUser`, `workspaceProgress`) — pure compositions over the capability services with pre-computed aggregates (unread count, per-workspace counts). They have **no Seed/Live adapters of their own** (ADR 0044 removed that god-object shape); web loaders and the REST `overview` endpoint consume them so app and Capability Interface views assemble the same data. Compute an aggregate here, not in a route handler or `useMemo`. `listWorkspacesForUser(userId)` is the "my workspaces" model: it takes no ambient `WorkspaceContext`, resolving the user's memberships via `WorkspaceMembership.listWorkspacesForUser` and scoping each per-workspace read itself.

A projection covers **one** permission. `workspaceDashboard` is everything `notification:read` reaches, and webhook endpoints are deliberately not in it: `webhook:list` is a separate permission a `member` does not hold, and a projection cannot check authorization (rule 2 below). The caller reads such a segment itself and drops it when the actor may not have it — see `apps/web/src/lib/server/workspace-dashboard.ts`. The old `workspaceSettingsSummary` was removed for exactly this reason: it bundled five permissions into one read, so a member's settings page received an API-token count and a webhook count the matrix denies them. A permission-shaped payload is assembled **above** this package.

The one projection that spans permissions, `workspaceProgress(options)` (the onboarding checklist, ADR 0054), takes the decision as an argument rather than making it: `developerPlatform: false` skips the API-token and webhook reads and leaves those two steps out. The dashboard loader computes the flag from the actor's `apiToken:list` and `webhook:list` with the same `authorize()` that backs `whenPermitted`. Every step is derived on each read from the owning capability — never a stored flag; only the dismissal is persisted, by `governance/workspace-onboarding`.

Each capability gets a leaf intent node alongside its source file. Read it before changing the capability's contract.

| Context            | Capability                                                                  | Reads from D1 tables                                  | Status                                                                                                                                                                     |
| ------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| billing            | [`billing`](src/billing/billing.AGENTS.md)                                  | `workspaces` (`planId`), `workspace_subscriptions`    | plan read, per-seat pricing + seat usage, Stripe checkout/portal handoff, provider event → plan change and seat reconciliation, queue-decoupled seat sync (audit-emitting) |
| developer-platform | [`api-token-registry`](src/developer-platform/api-token-registry.AGENTS.md) | `apiTokens`, `workspaces`                             | list, create, revoke, verify bearer (audit-emitting)                                                                                                                       |
| developer-platform | [`webhook-endpoints`](src/developer-platform/webhook-endpoints.AGENTS.md)   | `webhookEndpoints`, `webhookDeliveries`, `workspaces` | list, create, disable, rotate secret (audit-emitting)                                                                                                                      |
| developer-platform | [`webhook-publisher`](src/developer-platform/webhook-publisher.AGENTS.md)   | `webhookEndpoints`                                    | enqueue-only fan-out to `WEBHOOK_QUEUE` (no-op without binding)                                                                                                            |
| governance         | [`audit-event-log`](src/governance/audit-event-log.AGENTS.md)               | `auditEvents`, `user`, `workspaces`                   | list + `record(input)` for upstream emitters                                                                                                                               |
| governance         | [`workspace-invitations`](src/governance/workspace-invitations.AGENTS.md)   | `workspaceInvitations`, `workspaces`                  | reads direct; create/cancel/accept via the plugin binding; accept triggers seat sync                                                                                       |
| governance         | [`workspace-membership`](src/governance/workspace-membership.AGENTS.md)     | `workspaces`, `workspaceMembers`, `user`              | reads direct; add/remove/change-role via the plugin binding; add/remove trigger seat sync                                                                                  |
| governance         | [`workspace-lifecycle`](src/governance/workspace-lifecycle.AGENTS.md)       | `workspaces`                                          | create/rename/delete via the plugin binding (audit-emitting)                                                                                                               |
| governance         | [`platform-user-admin`](src/governance/platform-user-admin.AGENTS.md)       | `user`, `workspaceMembers`                            | system-admin ban/unban, cross-workspace role, impersonation via binding (audit- and notification-emitting)                                                                 |
| governance         | [`workspace-onboarding`](src/governance/workspace-onboarding.AGENTS.md)     | `workspaces` (`onboardingDismissedAt`), `user`        | checklist dismissal + actor two-factor read; steps derive in `workspaceProgress` (audit-emitting)                                                                          |
| governance         | [`turnstile-verification`](src/governance/turnstile-verification.AGENTS.md) | — (no store; calls Cloudflare `siteverify`)           | env-gated token verification (`inactive` when unconfigured)                                                                                                                |
| governance         | [`workspace-export`](src/governance/workspace-export.AGENTS.md)             | `workspaceExports`, `workspaces` (+ queue, R2 bucket) | request/list/signed link; background complete/fail; API download (audit-emitting)                                                                                          |
| notifications      | [`notification-feed`](src/notifications/notification-feed.AGENTS.md)        | `notifications`, `workspaces`, `workspaceMembers`, `user` | list, unread count, mark-read (`notification:read`-gated upstream), `create` + `notifyUser` (enqueues instant emails), email/digest reads |
| notifications      | [`notification-preferences`](src/notifications/notification-preferences.AGENTS.md) | `notification_preferences`                             | identity-keyed list/resolve/set per kind (audit-emitting)                                                                |

`governance/workspace-identity.ts` is not a capability: it owns the workspace identity vocabulary (`WORKSPACE_ROLES`, `SYSTEM_ROLES`, `Workspace`, `Member`, `toMember`, `toWorkspace`, `findWorkspaceMember`). `toWorkspace(row)` is the one row→`Workspace` projection — the context resolution, the membership projection, and the lifecycle read-backs all go through it, so the projected columns are decided once. The two role tuples are re-exports of `workspaceRoles` / `systemRoles` from [`packages/db`](../db/AGENTS.md)'s `enums.ts` — the stored columns are the source, this module only lifts them into `Schema.Literals`, and `user.role` is typed so no hand-narrowing helper is needed (a `null` there means `user`) so `workspace-context.ts` and `governance/workspace-membership.ts` no longer import each other. `workspace-membership.ts` depends on `WorkspaceContext` for its member reads, so the shared types and the member lookup live below both. Import identity types from this module, not from the membership capability.

Shared error types live in [`errors.ts`](src/errors.ts): `WorkspaceNotFound` (404), `CapabilityUnavailable` (503 — every Live-layer D1/queue failure surfaces as this via `internal/unavailable.ts`, never as a defect), and `MembershipChangeRejected` (409 — a membership change the workspace refuses, as against a store it cannot reach). `WorkspaceChangeRejected` (409 — same reading, naming the workspace itself). `UserAdminRejected` (409 — a system-level user change `/admin` refuses: an unknown account, a non-member role change, a System Admin as impersonation target). `ImpersonationForbidden` (403 — an account action an impersonation session may not perform; raised by the pure `refuseWhileImpersonating` guard in `platform-user-admin.ts`, which the web auth catchall answers with). `AuthorizationDenied` (403 — raised by `verifyBearerToken` for an unknown token, and by `requirePermission` for a denied one) is **declared in [`@b2b-saas-starter/authz`](../authz/AGENTS.md)** and re-exported from `errors.ts`, so this package and the guard raise one class. Never redeclare it here. Seed fixtures live in [`seed-fixture.ts`](src/seed-fixture.ts) and are consumed by [`layers.ts`](src/layers.ts).

`readPluginBindingFailure` (`governance/plugin-binding-failure.ts`) is imported directly as well. It is how a rejected plugin-binding call is classified — 4xx means the workspace refused, anything else means the store is unreachable — and the app that writes a binding needs it to assert its own rejections land on the right side (`apps/web/src/lib/server/invitation-binding.test.ts`).

## Where to put a new capability

1. Pick the bounded context that already owns the closest concept; only add a new folder when you genuinely have a new context.
2. Add `src/<context>/<capability>.ts` (Schema + Service + Seed + Live) — one file while it stays one screenful of each part.
   **Split it once the file passes ~300 lines, or as soon as a sibling needs one part of it without the rest.** The seam is always the same three modules, no barrel and no re-export shim (invariant 5), so consumers import the specific one:
   - `<capability>.ts` — the contract: schemas, input types, `XxxInterface`, the service class, the binding port, and any rule both adapters enforce.
   - `<capability>.seed.ts` — `SeedXxx`, its fixture types, and its in-memory helpers.
   - `<capability>.live.ts` — `LiveXxx` and its query helpers.

   A provider client or a policy table that only one consumer reaches gets its own sibling module on the same grounds — `billing/` is `plan-catalog.ts` (the plan records, `seatUsage`, and the entitlement gate), `billing.ts` (the contract), `billing.seed.ts` / `billing.live.ts` (the two adapters), `stripe.ts` (the REST client, the inbound event policies, the signature verifier), and `seat-sync.ts` (the producer port for the seat-sync queue), so `developer-platform/*` can import the plan gate without Stripe entering its dependency graph.

   Already split: `webhook-endpoints`, `api-token-registry`, `workspace-invitations`, `billing`, `workspace-export` (which also has two pure siblings: `workspace-export-archive.ts`, the ZIP builder, and `workspace-export-snapshot.ts`, the cross-capability read the background worker and the Seed adapter share). Everything else is one file, and should stay one until it earns the split.

3. Add `src/<context>/<capability>.AGENTS.md` describing the public surface, storage, and anti-patterns.
4. Wire `Seed*`/`Live*` into [`layers.ts`](src/layers.ts) — keep imports grouped by context.
5. Consumers import the capability module directly, e.g. `@b2b-saas-starter/capabilities/governance/<capability>` (enabled by the curated exports map — no `./src/*` wildcard; `starter/no-deep-workspace-imports` fails a `/src/` specifier).
6. Add a row to the table above.

## Cross-cutting invariants

1. **Per-workspace methods read the resolved workspace from `WorkspaceContext`, never from a `slug` parameter.** The slug→`Workspace` resolution happens once per request via `liveWorkspaceContext(slug)` or `seedWorkspaceContext(seedWorkspace, slug)` at the route boundary. Capability methods declare `WorkspaceContext` as an Effect requirement and read `ctx.workspace.id` internally. Callers still never see internal IDs.

   The exceptions are **identity-keyed** methods, which run before any single workspace has been selected and resolve one from their key instead: `WorkspaceMembership.listWorkspacesForUser(userId)`, and `WorkspaceInvitations.find` / `.accept` keyed by invitation id. The last two have no `WorkspaceContext` because they _cannot_ — the actor is not a member until the invitation makes them one, and the context layer refuses non-members by design. See [`workspace-invitations`](src/governance/workspace-invitations.AGENTS.md). Two more identity-keyed families came with ADR 0055: everything on `NotificationPreferences` (a preference belongs to the user across workspaces), and `NotificationFeed.create` / `loadForEmail` / `listDigestCandidates`, whose callers are background jobs holding a workspace id and no slug.

2. **Capabilities don't check authorization — the `WorkspaceContext` layer and the `requirePermission` guard do.** Workspace existence AND actor membership are enforced by the `WorkspaceContext` layer: `liveWorkspaceContext(slug, actor)` raises `WorkspaceNotFound` on an unknown slug, and — when an `ActorRef` (`{ userId }`) is passed — also for actors who are not members of the workspace, so a probing user cannot learn whether a workspace exists. `seedWorkspaceContext(…, actor, members)` mirrors the same semantics against the fixture members (`runtime.ts` passes `seedMembers`); `members` defaults to `[]`, so a bare `ActorRef` fails closed unless the fixture members are supplied. Callers that omit `actor` entirely (trusted server-side reads, e.g. the public showcase loader and the API worker after `verifyBearerToken`) get `actor: null`. Tests that already hold a fully resolved `Actor` inject it via `testWorkspaceContext(workspace, actor)` — no membership check, test-injection only.

   Whether the resolved actor may perform an action is decided one level up, by `requirePermission` from [`@b2b-saas-starter/authz`](../authz/AGENTS.md), composed at the route boundary: `requireWorkspacePermission` in `apps/web/src/lib/server/authorize.ts` and `enforcePermission` in `apps/api/src/handlers.ts`. The one method-level carve-out is `verifyBearerToken`, and it **authenticates only** — it answers which token this is and what scopes it carries, raising `AuthorizationDenied` (`invalid_token`) for an unknown or revoked one. It does not judge the scopes; the guard does. See [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md#authorization-model).

3. **Audit-event writes go through `AuditEventLog`, not direct D1 inserts.** Mutating capabilities (`ApiTokenRegistry`, `WebhookEndpoints`, `Billing.applyProviderEvent` / `.applySubscriptionEvent` / `.syncSeats`, `WorkspaceExports`) depend on `AuditEventLog` and either call `record(input)` or — for atomicity with their own write — run [`governance/audited-mutation.ts`](src/governance/audited-mutation.ts), the shared mutate+audit combinator that batches the mutation with `audit.prepareRecord(input)` so both commit or roll back together on D1 (`prepareRecord` is effectful: it reads `Clock` for the id and timestamp). `auditedMutations(deps)` is itself an Effect requiring `RawD1` — it resolves the binding `batch` needs once at layer construction, so the mutations it returns carry no requirement of their own. The `AuditEventLog` adapter owns id generation and timestamps so format changes happen in one place, and the combinator owns the zero-match skip (mutations matching no rows record no audit event) plus its documented phantom-audit race. Seed layers keep calling `record(input)` after their in-memory write.

   **The exception is the plugin-backed mutations** — `WorkspaceMembership` and `WorkspaceInvitations`. Their write happens over HTTP inside the binding adapter, so it cannot be enlisted into a `batch()`, and D1 rejects an explicit `BEGIN` (Drizzle's `d1/session.js` issues a raw `begin`, so `db.transaction()` does not work either). They call `record(input)` after the write and the two can therefore diverge. This is an accepted, recorded trade (ADR 0051), not an oversight to "fix" by dropping back to direct Drizzle writes — that would skip the plugin's validation and its lifecycle hooks.

4. **Seed and Live must satisfy the same `Interface`.** The `XxxInterface` type is the contract; both layers must implement it identically. Tests bind `Seed*` plus `testWorkspaceContext(...)` and rely on this equivalence to exercise route logic without D1. Where a capability mutates, matching types are not enough — write the cases once and run them against both adapters, as `governance/workspace-membership.contract.ts` does from `index.test.ts` and `governance/workspace-membership.live.test.ts`.

5. **Paged list reads page through `internal/keyset-cursor.ts` (ADR 0057).** Every list a REST route or MCP tool serves exposes a paged variant (`listPage`, `listMembersPage`; the audit log's `list` takes `cursor`/`limit` in its input) returning the shared `Page<T>` shape (`{ items, nextCursor }`), implemented identically by both adapters. Timestamped collections page newest-first on `(createdAt, id)`; wire shapes without a timestamp (members, webhook endpoints) page forward on `id`. The unpaged whole-collection read stays for the web app's own pages, which render collections small by construction. Paging stability across inserts is proven by the contract cases run against both adapters — a page's window is frozen at the cursor, so an insert between fetches never shifts, duplicates, or hides unseen rows.
6. **No barrel files.** Internal files import from `./<context>/<capability>.ts` (or `../<context>/<capability>.ts` from within a context). Consumers import `@b2b-saas-starter/capabilities/governance/workspace-membership` directly — one curated exports subpath per module, enforced by `starter/no-deep-workspace-imports`.
7. **Cross-context imports are explicit.** When a capability in one context depends on another (e.g. `developer-platform/*` → `governance/audit-event-log`), the relative path makes the seam visible. Don't paper over it with re-exports.

## Anti-patterns

- Don't take `slug: string` as a method parameter. Per-workspace methods depend on `WorkspaceContext` and read `ctx.workspace`. Cross-workspace reads belong in `listGlobal`-style methods (see `audit-event-log`).
- Don't write to D1 from a capability's Live layer without adding the matching Seed mutation. The contract is asymmetric otherwise and tests will silently pass.
- Don't widen `XxxInterface` to expose Drizzle row types. The schema struct is the wire contract.
- Don't inline `db.insert(auditEvents)`. Depend on `AuditEventLog` and call `audit.record(...)`.
- Don't drop a capability into the package root because you're "not sure" which context owns it. Pick a context and add a follow-up note in the leaf AGENTS.md if the boundary is provisional.

## External references

- Database schema: [`@b2b-saas-starter/db`](../db/AGENTS.md) — the source of truth for table shapes.
- Architecture security model: [`ARCHITECTURE.md`](../../ARCHITECTURE.md#security) — covers where (and where not) capability calls are gated.
