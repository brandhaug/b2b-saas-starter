# Workspace invitations

Invite an address, cancel a pending invitation, accept one. Accepting creates the membership; [`workspace-membership`](workspace-membership.AGENTS.md) owns every other membership change. Writes go through the `WorkspaceInvitationBinding` port, reads through Drizzle.

## Contracts

- `accept` and `find` are keyed by invitation id, with no `WorkspaceContext`: the accepter is not a member yet, so `liveWorkspaceContext` would refuse them. The invitation is the authorization, so a `requirePermission` gate there makes accepting unreachable; both adapters reject a mismatched address.
- `find` discloses the invited address to any id holder; the accept page's policy is `apps/web/src/lib/server/invitations.effects.ts`. `list` includes settled invitations, or the cancel button looks inert, and orders them newest first on `(createdAt, id)` in both adapters — the Seed row carries a storage-only `createdAt` for exactly that.

## Pitfalls

- `requirePending` / `requireRecipient` / `requireUnexpired` run in Live before the binding call, so refusals never depend on the wired binding. Recipient comparison lower-cases both sides, as the plugin does.
- `create` reads the new row back by `(workspaceId, email, status: 'pending')` instead of trusting the binding's return shape; one-pending-per-address keeps it unambiguous. Both adapters refuse the duplicate themselves with `already_invited` rather than leaving it to the plugin's message text.
- Every write and every lookup passes the address through `normalizeInvitationEmail`, and Live's lookup compares `lower(email)`. D1's default TEXT collation is BINARY, so a bare `eq` would let `Ada@x.test` and `ada@x.test` both hold a pending invitation while `requireRecipient` treats them as one recipient.
- `SeedWorkspaceInvitations` shares one `SeedRoster` with `SeedWorkspaceMembership` (built in `layers.ts`); split them and a seed accept adds a member membership never sees.
- `CONTRACT_EXPIRED_AT` is 1969-12-31 because `it.effect`'s `TestClock` starts at epoch 0, putting realistic past dates in its future. That fixture needs its own address: one address cannot hold two pending invitations.

## Boundaries

- No direct writes to `workspaceInvitations`, no `@b2b-saas-starter/auth` import to reach the plugin.
- The invitation id is a lookup key, not a bearer token; the address check protects the workspace.
