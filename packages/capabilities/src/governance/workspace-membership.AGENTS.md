# Workspace Membership

## Purpose & Scope

Lists members for the workspace selected by `WorkspaceContext`. The workspace context layer resolves the slug once, then every workspace-scoped capability reads the same selected workspace. **Not an authorization service** — see [`ARCHITECTURE.md`](../../../../ARCHITECTURE.md#authorization-model) for the authorization plan.

## Public surface

- `WorkspaceRole = 'owner' | 'admin' | 'member'` — the per-workspace role hierarchy. Stored on `workspaceMembers.role`.
- `SystemRole = 'admin' | 'user'` — global role, derived from Better Auth's `user.role`.
- `Workspace` — `{ id, slug, name, planId }`. Public DTO, no internal fields.
- `Member` — `{ id, name, email, role, systemRole }`. `id`/`name`/`email` come from `user`; `role` from `workspaceMembers`; `systemRole` is `user.role === 'admin' ? 'admin' : 'user'`.
- `WorkspaceMembership.listMembers` — `readonly Member[]` for the current `WorkspaceContext`.
- `WorkspaceMembership.listWorkspacesForUser(userId)` — `readonly WorkspaceWithMembership[]` (`{ workspace, member }`). Cross-workspace read keyed by user id, no `WorkspaceContext` — the "my workspaces" model resolved before any single workspace is selected. Possibly empty; never discloses workspaces the user is not in. The `listWorkspacesForUser` projection in `workspace-projections.ts` builds per-workspace counts on top of it, using the returned `member` as the actor.

## Storage

- Tables: `workspaces`, `workspaceMembers`, `user`.
- `listMembers` joins `workspaceMembers` to `user` on `userId`; rows where the user has been deleted are dropped by the inner join. Switch to a left join + tombstone display if you need to surface "removed user" entries. `listWorkspacesForUser` additionally joins `workspaces` for the workspace DTO.
- The Seed layer takes the fixture workspace alongside the members (`SeedWorkspaceMembership(members, workspace)`) so `listWorkspacesForUser` has a workspace to return for fixture members.
- `WorkspaceContext` is the single workspace-resolution point, so every workspace capability sees the same `WorkspaceNotFound` shape.

## Status & follow-ups

- Add `addMember(slug, userId, role)`, `removeMember(slug, userId)`, `changeRole(slug, userId, role)`, and emit corresponding `auditEvents`.
- Add `requireRole(slug, userId, role)` — the policy primitive for the authorization layer. Once written, every other capability's route guard can be expressed in terms of it.
- Surface invitation state (pending vs. accepted) when invites ship — `Member` will need a `pending` field or a separate `listInvitations` method.

## Anti-patterns

- Don't use this capability to check authorization. It tells you who's a member with what role; deciding whether they may perform an action is the route's responsibility.
- Don't resolve workspaces by `id` from outside the package. Routes select a workspace by slug through `WorkspaceContext`; the internal id is an implementation detail of the joins.
- Don't widen `WorkspaceRole` or `SystemRole` ad-hoc. A new role requires a migration on `workspaceMembers.role` / `user.role` plus a coordinated update to Better Auth's `admin()` plugin config.
