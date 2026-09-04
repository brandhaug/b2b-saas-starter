# Audit Event Log

## Purpose & Scope

Append-only event stream behind the workspace audit page and `/admin`. Producers append and never query. `audit-event-taxonomy.ts` holds the closed `eventType` / `targetType` unions; add a name there before a call site uses it.

## Entry Points & Contracts

- `prepareRecord` resolves the insert without executing it, so a D1-writing capability can `batch([mutation, auditInsert])`. It is an effect because the id and `createdAt` come from `Clock`; the Seed layer returns an inert `select 1`.
- `recordInWorkspace` is the audit step for plugin-backed mutations, reading `workspaceId` and `actorUserId` off `WorkspaceContext`. Capabilities that write D1 themselves use `auditedMutations` instead.
- `list` filters on `actorUserId`, `eventType`, and inclusive `since` / `until`. `AUDIT_EVENT_PAGE_SIZE` is a default, not a truncation, and an undecodable cursor yields an empty page rather than an error.
- `listGlobal` is a plain top-100 across all workspaces, system rows (`workspaceId = null`) included, deliberately unfiltered and admin-only.
- `actor` is the joined `user.name`, else `'system'` (left join).

## Patterns & Pitfalls

- Seed `record` appends into its own instance store, so events read back the way Live's inserts do. Adapters that must see each other's events therefore share one layer instance, built in `layers.ts`.
- `SeedAuditEventLog` takes `SeedAuditActor[]` and resolves `actor` to a display name, since that slot holds what Live's `user.name` join puts there, never a raw user id.
- Ids come from `newCapabilityId('aud')` in `internal/ids.ts`.

## Anti-patterns

- No `metadata` JSON on the wire unsanitized: it can hold IPs, scopes, and other PII.
- No `WorkspaceContext` built from an unauthenticated request. `list` has no auth check; that is the route's job.
- No event or target name invented at a call site.

> TODO(intent): no compound index on `(workspaceId, createdAt DESC, id DESC)`; revisit when keyset pages start scanning.
