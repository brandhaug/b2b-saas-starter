# Workspace Membership

## Purpose & Scope

Reads and changes the membership of the workspace selected by `WorkspaceContext`. The workspace context layer resolves the slug once, then every workspace-scoped capability reads the same selected workspace. **Not an authorization service** — see [`ARCHITECTURE.md`](../../../../ARCHITECTURE.md#authorization-model) and [`@b2b-saas-starter/authz`](../../../authz/AGENTS.md).

Reads and writes split by direction, and the split is deliberate:

- **Reads** go straight through Drizzle. `workspace-projections.ts` joins member data into dashboard reads, and an HTTP hop per read would wreck that.
- **Writes** go through Better Auth's `organization` plugin, so its validation and its lifecycle hooks apply. This package never names the plugin — it calls `WorkspaceMemberBinding`, and the app supplies the adapter (ADR 0051).

## Public surface

- `WorkspaceRole = 'owner' | 'admin' | 'member'` — the per-workspace role hierarchy. Stored on `workspaceMembers.role`.
- `SystemRole = 'admin' | 'user'` — global role, derived from Better Auth's `user.role`.
- `Workspace` — `{ id, slug, name, planId }`. Public DTO, no internal fields.
- `Member` — `{ id, name, email, role, systemRole }`. `id`/`name`/`email` come from `user`; `role` from `workspaceMembers`; `systemRole` is `user.role === 'admin' ? 'admin' : 'user'`.
- `WorkspaceMembership.listMembers` — `readonly Member[]` for the current `WorkspaceContext`.
- `WorkspaceMembership.listWorkspacesForUser(userId)` — `readonly WorkspaceWithMembership[]` (`{ workspace, member }`). Cross-workspace read keyed by user id, no `WorkspaceContext` — the "my workspaces" model resolved before any single workspace is selected. Possibly empty; never discloses workspaces the user is not in. The `listWorkspacesForUser` projection in `workspace-projections.ts` builds per-workspace counts on top of it, using the returned `member` as the actor.
- `WorkspaceMembership.addMember({ userId, role })` — adds a member, returns the `Member` read back after the write. Audits `workspace_member.added`.
- `WorkspaceMembership.removeMember({ userId })` — audits `workspace_member.removed`.
- `WorkspaceMembership.changeRole({ userId, role })` — returns the updated `Member`. Audits `workspace_member.role_changed`.
- `WorkspaceMemberBinding` — the write port: `addMember`, `removeMember`, `changeRole`, all promise-returning, all addressed by `workspaceId` plus a **member row id** (except `addMember`, which takes a user id). Supplied via `StarterEnv.memberBinding` / `LiveCapabilitiesOptions.memberBinding`.

## Errors

- `MembershipChangeRejected` (409, declared in `errors.ts`) — the workspace refused the change: an unknown user, a user who is not a member, a role the plugin will not take. The caller asked for something impossible.
- `CapabilityUnavailable` (503) — the store is unreachable, **or** no `memberBinding` was configured (`reason: 'no_member_binding'`). Retrying may work.

The Live adapter classifies a binding rejection by the thrown value's `statusCode`: 4xx becomes `MembershipChangeRejected`, everything else stays `CapabilityUnavailable`. Getting this backwards tells a caller to retry a request that can never succeed.

## Storage

- Tables: `workspaces`, `workspaceMembers`, `user`.
- Writes do not touch these tables directly — they go through the binding, and the adapter's plugin call does the write.
- `listMembers` joins `workspaceMembers` to `user` on `userId`; rows where the user has been deleted are dropped by the inner join. Switch to a left join + tombstone display if you need to surface "removed user" entries. `listWorkspacesForUser` additionally joins `workspaces` for the workspace DTO.
- The Seed layer takes the fixture workspace alongside the members (`SeedWorkspaceMembership(members, workspace)`) so `listWorkspacesForUser` has a workspace to return for fixture members.
- `WorkspaceContext` is the single workspace-resolution point, so every workspace capability sees the same `WorkspaceNotFound` shape.

## Seed / Live parity

`workspace-membership.contract.ts` holds the cases both adapters must satisfy (capabilities invariant 4). `index.test.ts` runs them against Seed with no D1; `live-layers.test.ts` runs the same list against Live on a real one. Add a method to the interface and add its cases there — a Seed adapter that quietly diverges is exactly what this catches, and it already caught one (Seed used to remove a non-member silently).

The cases assert no identity fields. Live joins `name`/`email` from `user`; the fixture has no `user` table, so `SeedWorkspaceMembership` fabricates them the way `SeedApiTokenRegistry.create` fabricates a token.

## Audit is not atomic

Membership writes and their audit rows can diverge. D1 rejects an explicit `BEGIN`, and a plugin write cannot join a `batch()`, so the two-statement `batch` trick the other mutating capabilities use is unavailable here. This is an accepted, recorded trade — not an oversight to "fix" by dropping back to direct Drizzle writes.

## Status & follow-ups

- `requireRole(slug, userId, role)` never shipped and is not wanted: authorization is `requirePermission` in [`@b2b-saas-starter/authz`](../../../authz/AGENTS.md), asked by permission rather than by role name.
- Surface invitation state (pending vs. accepted) when invites ship — `Member` will need a `pending` field or a separate `listInvitations` method.
- No app calls the mutations yet, so no adapter is wired into `StarterEnv.memberBinding`. Until one is, mutations answer `CapabilityUnavailable`.

## Anti-patterns

- Don't use this capability to check authorization. It tells you who's a member with what role; deciding whether they may perform an action is the route's responsibility.
- Don't write to `workspaceMembers` from here. The plugin owns those rows; a direct insert skips its validation and its hooks. Go through the binding.
- Don't import `@b2b-saas-starter/auth` to reach the plugin. `auth` and `capabilities` are siblings; the binding exists so neither depends on the other.
- Don't resolve workspaces by `id` from outside the package. Routes select a workspace by slug through `WorkspaceContext`; the internal id is an implementation detail of the joins.
- Don't widen `WorkspaceRole` or `SystemRole` ad-hoc. A new role requires a migration on `workspaceMembers.role` / `user.role` plus a coordinated update to Better Auth's `admin()` plugin config.
