# Notification Feed

## Purpose & Scope

Workspace-scoped notification stream: webhook-delivery anomalies, human-authored announcements, and account-level notices (an impersonation of the user's account, ADR 0054). Powers the bell icon, the dashboard attention list, and the notification panel in the workspace shell. Reads for the app; two writes for writers with no request context: `notifyUser` (identity-keyed, fans out per membership) and `notify` (workspace-keyed, for queue consumers — the workspace export consumer tells the requester their archive is ready through it). Notifications are inserted by background jobs, the seed fixture, `notifyUser`, and `notify`; there is no in-product authoring path. `markRead` stamps rows read.

## Public surface

- `Notification` — `{ id, title, message, createdAt, read }`. `read` is derived from `readAt !== null` on the row; the wire shape hides the timestamp.
- `NotificationFeed.list` — `readonly Notification[]` for the current `WorkspaceContext`. Newest first.
- `NotificationFeed.unreadCount` — `number`, computed with a `count(*)` query over rows with `readAt IS NULL` (no in-memory filtering).
- `NotificationFeed.markRead(ids)` — stamps the given unread ids read and returns how many rows changed. Idempotent: unknown, foreign, invisible, or already-read ids change nothing. The visibility filter is the read's filter, so the write never touches a row the actor cannot see. Input type: `MarkNotificationsReadInput` (`{ ids: string[] }`).
- **Actor scoping:** rows with `userId = NULL` are workspace broadcasts, visible to everyone; rows with a `userId` are only visible to that actor (`WorkspaceContext.actor`). Without an actor in context, only broadcast rows are returned. The Seed layer applies the same filter (seed rows may carry an optional `userId` via `SeedNotification`).
- `NotificationFeed.notifyUser({ userId, title, message })` — **identity-keyed write**, no `WorkspaceContext`: inserts one unread, user-targeted row per workspace the user is a member of (`workspaceMembers`), so whichever workspace they open next shows it. A user with no memberships receives nothing. Used by `platform-user-admin` at impersonation start. The Seed layer holds its rows in a `Ref` so a write reads back.
- `NotificationFeed.notify({ workspaceId, userId?, title, message })` — appends one unread row. Keyed by `workspaceId`, not `WorkspaceContext`, because its callers run on the queue where no request context exists (same shape as `AuditEventLog.record`). `userId` targets one member; `null` broadcasts. Id (`not_…`) and `createdAt` are minted here. The Seed adapter appends into a private copy of its fixture rows, scoped to the workspace it was notified for, so a notified row reads back through `list` like Live's insert.
- All methods can fail with `CapabilityUnavailable` (503) when D1 is unreachable.

## The permission decision: `notification:read`, not a write action

The role matrix has no `notification:write` action, and `markRead` deliberately does not add one (that would be a change to `@b2b-saas-starter/authz`, not this capability). Marking read is the actor **consuming their own feed** — the write side of `notification:read` — so the web server fn composes `requireWorkspacePermission({ notification: ['read'] })`, the same statement as the page gate. The capability itself stays authorization-free (invariant 2). The queue-consumer writes (`notifyUser`, `notify`) are upstream emitters, like `AuditEventLog.record`: no request, no guard, and the _content_ they write is owned by the emitting capability.

**Broadcast caveat (accepted trade):** `readAt` sits on the shared row, so marking a broadcast row read marks it for the whole workspace — the table has no per-actor read state. Per-actor read state (a join table) is the fix if this ever matters; do not silently re-derive `read` client-side to fake it.

## Storage

- Table: `notifications` (see [`@b2b-saas-starter/db`](../../../db/AGENTS.md)). `workspaceId` and `userId` are both nullable FKs; the visibility filter (`workspaceId = ? AND (userId IS NULL OR userId = actor)`) is shared between `list`, `unreadCount`, and `markRead` so scoping stays identical.
- `markRead` selects the matching unread ids first, then updates by id — the returned count is exact and the write is a single `UPDATE … WHERE id IN (…)`.

## Status & follow-ups

- Consider a `severity` field (`'info' | 'warning' | 'critical'`) once notification volume grows. The bell badge will want to differentiate.
- Per-actor read state for broadcast rows (see the caveat above).

## Anti-patterns

- Don't push transient UI toasts through this capability. Notifications are persistent — toasts belong in component state (`sonner`).
- Don't return `readAt` raw. The DTO collapses it to a boolean by design so the wire shape stays cacheable.
- Don't fan out to email/Slack from inside the capability. Outbound dispatch belongs in the background worker; this capability owns persistence only.
- Don't add a `notification:write` permission for feed writes. The decision above is recorded; revisit it only with a real second write behaviour (authoring, deleting).
- Don't give `notifyUser` a `workspaceId` parameter. It is for account-level notices; a workspace-scoped producer should read `WorkspaceContext` in a method of its own.

## Paging (ADR 0057)

`listPage` serves the REST/MCP list surface: newest-first on `(createdAt DESC, id DESC)` through the shared `internal/keyset-cursor.ts` recipe, `limit` clamped into `[1, 200]`, `nextCursor` null on the last page. An undecodable cursor yields an empty page. `list` stays the whole-collection read the app's own pages render — don't route the API surfaces through it.
