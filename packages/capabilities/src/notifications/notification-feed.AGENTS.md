# Notification Feed

## Purpose & Scope

Workspace-scoped notification stream: catalog-refresh failures, webhook-delivery anomalies, integration auth expirations, and human-authored announcements. Powers the bell icon and the notification panel in the workspace shell. Read-only today — notifications are inserted by background jobs and the seed fixture; there is no in-product authoring path.

## Public surface

- `Notification` — `{ id, title, message, createdAt, read }`. `read` is derived from `readAt !== null` on the row; the wire shape hides the timestamp.
- `NotificationFeed.list` — `readonly Notification[]` for the current `WorkspaceContext`. Newest first.
- `NotificationFeed.unreadCount(slug)` — `number` or `WorkspaceNotFound`. Computed by counting rows with `readAt = null`.

## Storage

- Table: `notifications` (see [`@b2b-saas-starter/db`](../../../db/AGENTS.md)).
- `requireWorkspace` helper inside the layer resolves slug → workspace and fails with `WorkspaceNotFound` — shared between both methods so the auth-shaped failure is identical.

## Status & follow-ups

- Add `markRead(slug, id)` and `markAllRead(slug)` mutators. Both should stamp `readAt = now` and the second should be a single batch update.
- Consider a `severity` field (`'info' | 'warning' | 'critical'`) once notification volume grows. The bell badge will want to differentiate.
- `unreadCount` currently fetches all rows and filters in memory. Replace with a `count() where readAt is null` query when row counts grow past a few thousand per workspace.

## Anti-patterns

- Don't push transient UI toasts through this capability. Notifications are persistent — toasts belong in component state (`sonner`).
- Don't return `readAt` raw. The DTO collapses it to a boolean by design so the wire shape stays cacheable.
- Don't fan out to email/Slack from inside the capability. Outbound dispatch belongs in the background worker; this capability owns persistence only.
