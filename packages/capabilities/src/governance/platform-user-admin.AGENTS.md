# platform-user-admin

## Purpose

System-level user administration for `/admin`: ban/unban accounts, change a
user's workspace role across workspaces, and start/stop an impersonation
session (ADR 0054). The write half goes through Better Auth via the structural
`PlatformUserAdminBinding` port — the `admin` plugin's `banUser`/`unbanUser`/
`impersonateUser`/`stopImpersonating` plus one organization-plugin
`updateMemberRole`. Every endpoint behind the port is `requireHeaders: true`:
the plugin enforces the admin role from the request's own session, so only the
app can supply the adapter (`apps/web/src/lib/server/user-admin-binding.ts`),
per call.

## Surface

- `listUsers` → every account (`id`, `name`, `email`, `systemRole`, `banned`),
  read direct from the `user` table. Not paginated.
- `banUser({ userId, actorUserId })` / `unbanUser(...)` — refuse an unknown
  account with `UserAdminRejected('unknown_user')` **before** calling the
  binding, so a no-op UPDATE can never produce an audit row.
- `changeWorkspaceRole({ userId, workspaceId, role, actorUserId })` —
  identity-keyed (explicit `workspaceId`; `/admin` has no ambient
  `WorkspaceContext`). Resolves the member's surrogate id, writes through the
  binding, reads the membership back and returns it.
- `startImpersonation({ userId, actorUserId })` — refuses an unknown target
  (`unknown_user`), a System Admin target (`cannot_impersonate_admin`) and the
  admin's own account (`cannot_impersonate_self`) before the binding call; then
  audits `system_admin.impersonation_started` (actor = admin, target = user,
  `metadata.expiresInSeconds`) and writes the impersonated user a Notification
  through `NotificationFeed.notifyUser`. Returns
  `{ userId, expiresInSeconds: IMPERSONATION_SESSION_SECONDS }`. The session
  itself — cookies, expiry, `session.impersonatedBy` — is Better Auth's.
- `stopImpersonation({ userId, actorUserId })` — the binding restores the
  admin's session; audits `system_admin.impersonation_stopped` against the same
  pair. `actorUserId` is read off `session.impersonatedBy` by the caller, never
  off a request body.
- `refuseWhileImpersonating(session, action)` — **pure guard**, no layer: fails
  `ImpersonationForbidden` when `session.impersonatedBy` is set and `action` is
  one of `IMPERSONATION_FORBIDDEN_ACTIONS` (`change_password`,
  `change_two_factor`, `change_email`, `delete_account`). The web catchall maps
  Better Auth's endpoints onto these actions
  (`apps/web/src/lib/server/impersonation-guard.ts`) and answers 403.
- `IMPERSONATION_SESSION_SECONDS` (3600) — the number `packages/auth` restates
  as `impersonationSessionDuration`; that package cannot import this one
  (siblings), so change both together.

Audit events: `system_admin.user_banned`, `system_admin.user_unbanned`,
`system_admin.user_role_changed` (carries the `workspaceId`, so it also appears
in that workspace's audit page), `system_admin.impersonation_started`,
`system_admin.impersonation_stopped`. All recorded after the plugin write, not
batched (ADR 0051 trade).

Failures: refusals from the plugin or this package's own pre-checks surface as
`UserAdminRejected` (409); no binding or store failure as
`CapabilityUnavailable`; the impersonation guard as `ImpersonationForbidden`
(403).

Dependencies: both adapters need `AuditEventLog` and `NotificationFeed`;
`layers.ts` provides the shared fixture/Live instances to the merged layer.

## Seed

`SeedPlatformUserAdmin(users, memberships)` holds one impersonation at a time
(a `Ref<string | null>` keyed by the impersonated user — Better Auth holds one
admin cookie per browser). `stopImpersonation` for a user who is not the current
one fails `UserAdminRejected('not_impersonating')`, mirroring the plugin's 400.

## Tests

- `platform-user-admin.contract.ts` — run against Seed (`index.test.ts`) and
  Live (`platform-user-admin.live.test.ts`); needs an `admin` id (Seed:
  `usr_demo`, Live: `usr_sysadmin`).
- `platform-user-admin.test.ts` — the forbidden-actions guard, and the Seed
  side effects (notification visible to the target only, self/no-session
  refusals).

## Anti-patterns

- Don't let ban/unban audit before confirming the account exists — Live's
  pre-check is the guarantee; keep it.
- Don't let an impersonation start without `actorUserId` — the input type makes
  it required; an unattributed impersonation is worse than none.
- Don't read the session state here. The capability never learns whether the
  _caller's_ session is an impersonation; the app reads `impersonatedBy` and
  passes it to `refuseWhileImpersonating` or as `actorUserId`.
- Don't take a slug parameter; this capability is system-level by design and
  addresses workspaces by explicit id.
