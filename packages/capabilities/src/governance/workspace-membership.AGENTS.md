# Workspace Membership

## Purpose & Scope

Reads and changes the roster of the workspace in `WorkspaceContext`. Not an authorization service: it says who is a member with which role, and the route decides what they may do. Identity types live in `workspace-identity.ts`.

Reads go through Drizzle, since `workspace-projections.ts` joins member data into dashboard reads. Writes go through the `WorkspaceMemberBinding` port.

## Entry Points & Contracts

- `addMember` audits `workspace_member.added` and publishes seat sync `member_added`; `removeMember` audits `.removed` and publishes `member_removed`; `changeRole` audits `.role_changed` and publishes nothing. Seat publishing is best-effort.
- `WorkspaceMemberBinding` addresses rows by `workspaceId` plus the member row id; `addMember` alone takes a user id.
- `listWorkspacesForUser(userId)` is identity-keyed, resolved before a workspace is selected, and never discloses workspaces the user is outside.
- `MembershipChangeRejected` (409) is a refusal: unknown user, non-member, a role the plugin refuses. `CapabilityUnavailable` (503) is a retryable store failure or a missing binding (`reason: 'no_member_binding'`). Reversing the split tells callers to retry the impossible.

## Patterns & Pitfalls

- `listMembers` inner-joins `user`, so a member whose user row is gone silently drops off the roster; a tombstone display needs a left join.
- `layers.ts` builds one `SeedRoster` shared with `SeedWorkspaceInvitations` and `SeedAccountLifecycle`: accepting an invitation adds a member and deleting an account removes one, so separate `Ref`s let those adapters disagree about the roster. Seed `addMember` fabricates identity fields, having no `user` table to join.

## Anti-patterns

- No direct writes to `workspaceMembers`, and no `@b2b-saas-starter/auth` import to reach the plugin.
- No widening `WorkspaceRole` or `SystemRole` here: they re-export `packages/db` enums, and a new role needs the migration plus a matching Better Auth `admin()` config.
- No `requireRole` helper, and no resolving a workspace by internal `id` from outside the package; authorization is asked by permission, workspaces by slug.
