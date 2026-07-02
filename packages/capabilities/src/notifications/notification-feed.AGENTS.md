# Notification Feed

## Purpose & Scope

Workspace-scoped notification stream: catalog-refresh failures, webhook-delivery anomalies, integration auth expirations, and human-authored announcements. Powers the bell icon and the notification panel in the workspace shell. Read-only today — notifications are inserted by background jobs and the seed fixture; there is no in-product authoring path.

## Public surface

- `Notification` — `{ id, title, message, createdAt, read }`. `read` is derived from `readAt !== null` on the row; the wire shape hides the timestamp.
- `NotificationFeed.list` — `readonly Notification[]` for the current `WorkspaceContext`. Newest first.
- `NotificationFeed.unreadCount` — `number`, computed with a `count(*)` query over rows with `readAt IS NULL` (no in-memory filtering).
- **Actor scoping:** rows with `userId = NULL` are workspace broadcasts, visible to everyone; rows with a `userId` are only visible to that actor (`WorkspaceContext.actor`). Without an actor in context, only broadcast rows are returned. The Seed layer applies the same filter (seed rows may carry an optional `userId` via `SeedNotification`).
- Both methods can fail with `CapabilityUnavailable` (503) when D1 is unreachable.

## Storage

- Table: `notifications` (see [`@b2b-saas-starter/db`](../../../db/AGENTS.md)). `workspaceId` and `userId` are both nullable FKs; the visibility filter (`workspaceId = ? AND (userId IS NULL OR userId = actor)`) is shared between `list` and `unreadCount` so scoping stays identical.

## Status & follow-ups

- Add `markRead(slug, id)` and `markAllRead(slug)` mutators. Both should stamp `readAt = now` and the second should be a single batch update.
- Consider a `severity` field (`'info' | 'warning' | 'critical'`) once notification volume grows. The bell badge will want to differentiate.

## Anti-patterns

- Don't push transient UI toasts through this capability. Notifications are persistent — toasts belong in component state (`sonner`).
- Don't return `readAt` raw. The DTO collapses it to a boolean by design so the wire shape stays cacheable.
- Don't fan out to email/Slack from inside the capability. Outbound dispatch belongs in the background worker; this capability owns persistence only.
