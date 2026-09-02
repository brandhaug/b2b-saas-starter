# Notification Feed

## Purpose & Scope

Workspace-scoped notification stream: webhook-delivery anomalies and human-authored announcements. Powers the bell icon, the dashboard attention list, and the notification panel in the workspace shell. Notifications are inserted by background jobs and the seed fixture; there is no in-product authoring path, but the feed is no longer read-only — `markRead` stamps rows read.

## Public surface

- `Notification` — `{ id, title, message, createdAt, read }`. `read` is derived from `readAt !== null` on the row; the wire shape hides the timestamp.
- `NotificationFeed.list` — `readonly Notification[]` for the current `WorkspaceContext`. Newest first.
- `NotificationFeed.unreadCount` — `number`, computed with a `count(*)` query over rows with `readAt IS NULL` (no in-memory filtering).
- `NotificationFeed.markRead(ids)` — stamps the given unread ids read and returns how many rows changed. Idempotent: unknown, foreign, invisible, or already-read ids change nothing. The visibility filter is the read's filter, so the write never touches a row the actor cannot see. Input type: `MarkNotificationsReadInput` (`{ ids: string[] }`).
- **Actor scoping:** rows with `userId = NULL` are workspace broadcasts, visible to everyone; rows with a `userId` are only visible to that actor (`WorkspaceContext.actor`). Without an actor in context, only broadcast rows are returned. The Seed layer applies the same filter (seed rows may carry an optional `userId` via `SeedNotification`).
- All methods can fail with `CapabilityUnavailable` (503) when D1 is unreachable.

## The permission decision: `notification:read`, not a write action

The role matrix has no `notification:write` action, and `markRead` deliberately does not add one (that would be a change to `@b2b-saas-starter/authz`, not this capability). Marking read is the actor **consuming their own feed** — the write side of `notification:read` — so the web server fn composes `requireWorkspacePermission({ notification: ['read'] })`, the same statement as the page gate. The capability itself stays authorization-free (invariant 2).

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
