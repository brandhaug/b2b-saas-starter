# Audit Event Log

## Purpose & Scope

Append-only stream of workspace and system events for compliance, security review, and admin UIs. Powers admin dashboards and per-workspace audit views. Exposes a `record(input)` write path used by other capabilities (today: `api-token-registry` lifecycle) — domain producers append, they do not query.

## Public surface

- `AuditEvent` — `{ id, eventType, targetType, actor, createdAt }`. `actor` is the user's display name (joined from `user`) or `'system'` if `actorUserId` is null.
- `AuditEventLog.list` — `readonly AuditEvent[]` for the current `WorkspaceContext`. Returns up to 100 most recent events for the workspace.
- `AuditEventLog.listGlobal` — `readonly AuditEvent[]`. Top 100 across all workspaces, including `workspaceId = null` system events. Admin-only consumer.
- `AuditEventLog.record(input)` — append-only insert. `RecordAuditEventInput` is `{ workspaceId?, actorUserId?, eventType, targetType, targetId?, metadata? }`. `eventType` and `targetType` are free-form strings on the wire; producers should namespace (`api_token.created`, `api_token.revoked`, `api_token.used`). The Seed layer is a no-op so tests can assert call-site invocation without a fixture.
- `AuditEventLog.prepareRecord(input)` — builds the audit insert statement (this capability still owns id + timestamp) **without executing it**, so mutating capabilities can run `batch(db, [mutation, auditInsert])` from `@b2b-saas-starter/db` and get an atomic D1 write. The Seed layer returns an inert `select 1` statement.

## Storage

- Table: `auditEvents` (see [`@b2b-saas-starter/db`](../../../db/AGENTS.md)).
- Joins to `user` on `actorUserId` to resolve the display name. Left join — `auditUser?.name ?? 'system'` is the fallback.
- 100-row cap is hardcoded in the Live layer. Increase carefully — this is also what bounds the admin UI's payload.
- `record()`/`prepareRecord()` mint IDs via the shared `newCapabilityId('aud')` helper (`aud_${Date.now()}_${8-byte hex}`). If you migrate to a domain ULID/cuid, update `internal/ids.ts` and any callers asserting on the ID shape.

## Status & follow-ups

`record()` is wired; producers still to add:

- **Auth surface** — failed sign-ins, sign-outs, password resets, OAuth account links.
- **Workspace admin** — role changes, member invites, member removals, plan changes.
- **Webhook lifecycle** — endpoint create/update/disable, secret rotation ([`webhook-endpoints`](../developer-platform/webhook-endpoints.AGENTS.md)).

API token lifecycle is wired today — see [`api-token-registry`](../developer-platform/api-token-registry.AGENTS.md). When the producer list grows, consider tightening `eventType`/`targetType` to a tagged union at the capability boundary while keeping the wire shape stringly-typed.

## Anti-patterns

- Don't expose `metadata` JSON on the wire without sanitizing — it can hold IPs, scopes, and other PII.
- Don't provide `WorkspaceContext` from an unauthenticated request. The `list` method has no auth check — that's the route's job.
- Don't widen the 100-row cap without a corresponding `since`/pagination cursor. Admin UI assumes the cap is the contract.
