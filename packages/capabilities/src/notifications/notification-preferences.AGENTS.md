# Notification Preferences

## Purpose & Scope

Per-user, per-kind email channel for notifications: `off | instant | digest` (ADR 0061). Identity-keyed, since a preference follows the user across every workspace. Read by `/account` and by the feed's instant fan-out; written by `/account` only.

## Entry Points & Contracts

- `list(userId)` returns one entry per kind with defaults filled in, so the UI renders the matrix without knowing the default policy. `isDefault` marks the kinds with no stored row.
- `resolve(userId, kind)` is what the feed calls per recipient during fan-out.
- `set` upserts the row and records `notification_preference.changed` in the same batch. Choosing the kind's own default still stores a row, because the user said so.
- Defaults live in code, in `defaultChannelFor`: security kinds are `instant`, everything else `digest`.

## Patterns & Pitfalls

- The vocabularies (`notificationKinds`, `securityNotificationKinds`, `notificationChannels`) are stored enums in `packages/db`; this context lifts them into `Schema.Literals` and never redeclares them.
- `notification-kinds.ts` also owns `NOTIFICATION_KIND_DESCRIPTIONS`, the copy shared by the UI and the email subjects.

## Anti-patterns

- No seeded default rows. Defaults are code; a stored row means the user chose.
- No workspace dimension. Per-workspace channels would be a new capability, not a column.
- No one-click URL calling `set`. The unsubscribe link lands on the signed-in `/account/notifications` page, which calls the session-gated server function.
