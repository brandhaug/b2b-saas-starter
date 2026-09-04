# Notification Preferences

## Purpose & Scope

Per-user, per-kind email channel for Notifications: `off | instant | digest`. Identity-keyed (a preference follows the user across every workspace), so there is no `WorkspaceContext` — same family as `WorkspaceMembership.listWorkspacesForUser`. Read by the `/account` page and by the feed's instant fan-out; written by the `/account` page only. Decision record: ADR 0061.

## Public surface

- `NotificationPreference` — `{ kind, channel, isDefault }`. `isDefault` is true when no row exists and the kind's default applies.
- `NotificationPreferences.list(userId)` — one entry per kind in `NOTIFICATION_KINDS`, defaults filled in. The UI renders this matrix without knowing the default policy.
- `NotificationPreferences.resolve(userId, kind)` — the channel that applies. The feed calls this per recipient when it fans out.
- `NotificationPreferences.set({ userId, kind, channel })` — upserts the row and records `notification_preference.changed` (`targetType: 'user'`, `actorUserId: userId`, metadata `{ kind, channel, defaultChannel }`) in the same D1 batch (`governance/audited-mutation.ts`, like every D1-writing audit-emitting capability). Choosing the kind's default still stores a row: the user said so.
- Pure helpers in `notification-kinds.ts`: `defaultChannelFor(kind)` (security kinds → `instant`, else `digest`), `resolveChannel(kind, stored)`, `isSecurityNotificationKind`, and `NOTIFICATION_KIND_DESCRIPTIONS` (the human copy the UI and the email subjects share). `resolvePreferences(stored)` in this module builds the full matrix and is used by both adapters.

## Storage

- Table: `notification_preferences` — `id`, `userId` (FK cascade), `kind`, `channel`, `updatedAt` (ISO text), unique on `(userId, kind)`. The Live `set` is an `INSERT … ON CONFLICT DO UPDATE` on that index.
- The vocabularies (`notificationKinds`, `securityNotificationKinds`, `notificationChannels`) are stored enums in `packages/db/src/enums.ts`; this context lifts them into `Schema.Literals` and never redeclares them.

## Anti-patterns

- Don't seed default rows. Defaults are code; a stored row means the user chose.
- Don't add a workspace dimension. A user who wants different channels per workspace is a new capability, not a column.
- Don't let a one-click URL call `set`. The unsubscribe link lands on the signed-in `/account/notifications` page, which calls the session-gated server function.
