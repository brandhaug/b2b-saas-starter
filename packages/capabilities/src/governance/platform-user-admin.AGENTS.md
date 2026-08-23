# platform-user-admin

## Purpose

System-level user administration for `/admin`: ban/unban accounts and change a
user's workspace role across workspaces. The write half goes through Better
Auth via the structural `PlatformUserAdminBinding` port — the `admin` plugin's
`banUser`/`unbanUser` plus one organization-plugin `updateMemberRole`. Every
endpoint behind the port is `requireHeaders: true`: the plugin enforces the
admin role from the request's own session, so only the app can supply the
adapter (`apps/web/src/lib/server/user-admin-binding.ts`), per call.

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

Audit events: `system_admin.user_banned`, `system_admin.user_unbanned`,
`system_admin.user_role_changed` (the role event carries the `workspaceId`, so
it also appears in that workspace's audit page; ADR 0051 trade — recorded after
the plugin write, not batched).

Failures: refusals from the plugin or this package's own pre-checks surface as
`UserAdminRejected` (409); no binding or store failure as
`CapabilityUnavailable`.

## Anti-patterns

- Don't let ban/unban audit before confirming the account exists — Live's
  pre-check is the guarantee; keep it.
- Don't add impersonation here — ADR 0024 defers it to the audit-trail map.
- Don't take a slug parameter; this capability is system-level by design and
  addresses workspaces by explicit id.
