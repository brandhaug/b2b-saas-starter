# Audit Event Log

## Purpose & Scope

Append-only stream of workspace and system events for compliance, security review, and admin UIs. Powers admin dashboards and per-workspace audit views. Exposes a `record(input)` write path used by other capabilities (today: `api-token-registry` lifecycle) — domain producers append, they do not query.

## Public surface

- `AuditEvent` — `{ id, eventType, targetType, targetId, actor, createdAt }`. `actor` is the user's display name (joined from `user`) or `'system'` if `actorUserId` is null. `targetId` is what was acted on (`string | null`).
- `AuditEventLog.list(input?)` — a page `{ events, nextCursor }` for the current `WorkspaceContext`. `input` carries optional server-side filters: `actorUserId`, `eventType`, `since`/`until` (inclusive ISO bounds), and an opaque keyset `cursor`. Pages are exactly `AUDIT_EVENT_PAGE_SIZE` (100) events ordered by `(createdAt DESC, id DESC)`; `nextCursor` is non-null only when the cap cut rows off. An undecodable cursor addresses no position — empty page.
- `AuditEventLog.listGlobal` — `readonly AuditEvent[]`. Top 100 across all workspaces, including `workspaceId = null` system events. Admin-only consumer. Deliberately unpaginated and unfiltered (the `/admin` upgrade is out of scope).
- `AuditEventLog.record(input)` — append-only insert. `RecordAuditEventInput` is `{ workspaceId?, actorUserId?, eventType, targetType, targetId?, metadata? }`. `eventType` and `targetType` are free-form strings on the wire; producers should namespace (`api_token.created`, `api_token.revoked`, `workspace_member.role_changed` — there is deliberately no per-request `api_token.used`; see the API-token registry node). The Seed `record` **appends into its instance's store** (a private copy of the fixture rows), so recorded events read back through `list`/`listGlobal` exactly as Live's inserts do — mutating-capability Seeds depend on this. It resolves `actor` to the fixture identity's display name through the `SeedAuditActor[]` handed to `SeedAuditEventLog` (`layers.ts` passes `seedSystemUsers`), because that slot holds what Live's `user.name` join puts there — never a raw user id. Adapters that must see each other's events share ONE layer instance (see `layers.ts`).
- `recordInWorkspace(audit, event)` — the plugin-backed mutations' audit step (`WorkspaceMembership`, `WorkspaceInvitations`, `WorkspaceLifecycle.rename`): reads `workspaceId` and `actorUserId` off `WorkspaceContext` so the caller names only the event, and documents the ADR 0051 non-atomicity once. Not for capabilities that write to D1 themselves — those batch through `auditedMutations`.
- `AuditEventLog.prepareRecord(input)` — resolves the audit insert statement (this capability still owns id + timestamp) **without executing it**, so mutating capabilities can `yield*` it and run `batch([mutation, auditInsert])` from `@b2b-saas-starter/db` for an atomic D1 write. It is an effect because id and `createdAt` come from `Clock`. The Seed layer returns an inert `select 1` statement.

## Storage

- Table: `auditEvents` (see [`@b2b-saas-starter/db`](../../../db/AGENTS.md)).
- Joins to `user` on `actorUserId` to resolve the display name. Left join — `auditUser?.name ?? 'system'` is the fallback.
- 100-row cap is fixed (`AUDIT_EVENT_PAGE_SIZE`), paired with keyset pagination on `(createdAt DESC, id DESC)` — the cap is the page size, not a silent truncation. Don't widen it without revisiting this contract. `listGlobal` keeps its plain top-100 shape.
- The read contract (filters + keyset pagination) is written once in `audit-event-log.contract.ts` and run against both adapters — Seed filters its enriched `SeedAuditEventRow`s in memory, Live pushes everything into SQL. Full-page pagination is covered Live-side only (needs > cap rows).
- Follow-up: no compound index on `(workspaceId, createdAt DESC, id DESC)` yet; `audit_events_workspace_created_at_idx` answers both query shapes at starter scale. Revisit if a workspace's event volume makes keyset pages scan.
- `record()`/`prepareRecord()` mint IDs via the shared `newCapabilityId('aud')` helper (`aud_${Clock millis}_${8-byte hex}`). If you migrate to a domain ULID/cuid, update `internal/ids.ts` and any callers asserting on the ID shape.

## Status & follow-ups

`record()` is wired; producers still to add:

- **Auth surface** — failed sign-ins, sign-outs, password resets, OAuth account links.
- **Workspace admin** — role changes, member invites, member removals, plan changes.
- **Webhook lifecycle** — endpoint create/update/disable, secret rotation ([`webhook-endpoints`](../developer-platform/webhook-endpoints.AGENTS.md)).

API token lifecycle is wired today — see [`api-token-registry`](../developer-platform/api-token-registry.AGENTS.md). The event/target vocabulary now lives in [`audit-event-taxonomy`](src/governance/audit-event-taxonomy.ts) and is enforced here at the write boundary; add new producer names to the module first (the read path stays stringly by design).

## Anti-patterns

- Don't expose `metadata` JSON on the wire without sanitizing — it can hold IPs, scopes, and other PII.
- Don't provide `WorkspaceContext` from an unauthenticated request. The `list` method has no auth check — that's the route's job.
- Don't widen the 100-row cap without a corresponding `since`/pagination cursor. Admin UI assumes the cap is the contract.
