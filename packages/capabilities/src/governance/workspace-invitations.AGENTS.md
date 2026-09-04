# Workspace Invitations

## Purpose & Scope

Invite an address, cancel a pending invitation, accept one. Accepting creates the membership; [`workspace-membership`](workspace-membership.AGENTS.md) owns every other membership change. Writes go through the `WorkspaceInvitationBinding` port, reads through Drizzle.

## Entry Points & Contracts

- `accept` and `find` are keyed by invitation id, with no `WorkspaceContext`: the accepter is not a member yet, so `liveWorkspaceContext` would refuse them. The invitation is the authorization, so a `requirePermission` gate there makes accepting unreachable; both adapters reject a mismatched address.
- `find` discloses the invited address to any id holder; the accept page's policy is `apps/web/src/lib/server/invitations.effects.ts`. `list` includes settled invitations, or the cancel button looks inert.
- Audits `workspace_invitation.sent`, `.canceled`, `.accepted`. `accept` also publishes `invitation_accepted` through the best-effort `SeatSyncPublisher`.
- `MembershipChangeRejected` (409) is every refusal: unknown, settled, expired, wrong address, already a member. `CapabilityUnavailable` also covers `reason: 'no_invitation_binding'`.

## Patterns & Pitfalls

- `requirePending` / `requireRecipient` / `requireUnexpired` run in Live before the binding call, so refusals never depend on the wired binding. Recipient comparison lower-cases both sides, as the plugin does.
- `create` reads the new row back by `(workspaceId, email, status: 'pending')` instead of trusting the binding's return shape; one-pending-per-address keeps it unambiguous.
- `SeedWorkspaceInvitations` shares one `SeedRoster` with `SeedWorkspaceMembership` (built in `layers.ts`); split them and a seed accept adds a member membership never sees.
- `CONTRACT_EXPIRED_AT` is 1969-12-31 because `it.effect`'s `TestClock` starts at epoch 0, putting realistic past dates in its future. That fixture needs its own address: one address cannot hold two pending invitations.

## Anti-patterns

- No direct writes to `workspaceInvitations`, no `@b2b-saas-starter/auth` import to reach the plugin.
- The invitation id is a lookup key, not a bearer token; the address check protects the workspace.

> TODO(intent): no `pending` flag on `Member`, no reject surface, no `apps/api` binding (#64).
