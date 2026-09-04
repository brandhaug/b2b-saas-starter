# Platform User Admin

## Purpose & Scope

System-level user administration for `/admin` (ADR 0054): ban and unban accounts, change a user's role in a named workspace, start and stop impersonation. Workspaces are addressed by explicit id, `/admin` having no `WorkspaceContext`. Writes go through `PlatformUserAdminBinding`; every endpoint behind it is `requireHeaders: true`, so only the app can supply an adapter, per call.

## Entry Points & Contracts

- `banUser` / `unbanUser` refuse an unknown account with `UserAdminRejected('unknown_user')` before calling the binding, so a no-op update never leaves an audit row.
- `changeWorkspaceRole` resolves the member's surrogate row id (`not_a_member` when absent), writes, then reads back; a read-back finding nothing is `not_a_member_after_write`, never a claimed success.
- `startImpersonation` refuses an unknown target, the admin's own account, and a System Admin target (`refuseImpersonationTarget`, matching `allowImpersonatingAdmins: false`) before the binding call, then notifies the target through `NotificationFeed.notifyUser`, worded once by `impersonationNotice`.
- `stopImpersonation` audits `system_admin.impersonation_stopped`. Its `actorUserId` comes from `session.impersonatedBy`, never from a request body.
- Audits `system_admin.user_banned`, `.user_unbanned`, `.user_role_changed` (carrying `workspaceId`, so it also lands in that workspace's audit page), `.impersonation_started`, `.impersonation_stopped`.
- `refuseWhileImpersonating` is a pure guard with no layer, failing `ImpersonationForbidden` (403) whenever `session.impersonatedBy` is set. Its `action` is typed to `IMPERSONATION_FORBIDDEN_ACTIONS`, so the forbidden set is compile-time; `apps/web/src/lib/server/impersonation-guard.ts` maps Better Auth endpoints onto it.

## Patterns & Pitfalls

- `IMPERSONATION_SESSION_SECONDS` is restated as `impersonationSessionDuration` in `packages/auth`, which cannot import this sibling package. Change both together.
- Seed holds one impersonation at a time, mirroring one admin cookie per browser; stopping a different user fails `UserAdminRejected('not_impersonating')`, as the plugin's 400 does.

## Anti-patterns

- No impersonation start without `actorUserId`; an unattributed one is worse than none.
- No session state read here; the app passes `impersonatedBy` in.
- No slug parameter; this capability is system-level.
