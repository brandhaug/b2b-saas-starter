# account-lifecycle

## Purpose & Scope

Self-service account deletion and its workspace teardown — what happens to a
user's **Workspace** memberships when they delete their own account. Contract
(`account-lifecycle.ts`), seed adapter (`account-lifecycle.seed.ts`), live
adapter (`account-lifecycle.live.ts`).

Identity-keyed throughout (no `WorkspaceContext`): the actor is asking about
every workspace they belong to at once, before any single one is selected —
the same family as `WorkspaceMembership.listWorkspacesForUser`.

## The ownership rule

`planAccountDeletion` is the rule both adapters share, per membership, in
order of precedence:

1. The user is the workspace's only member → `delete_workspace` (the workspace
   goes with the account).
2. The user is an owner and the only owner → `blocked_sole_owner` (leaving
   would strand the other members; the organization plugin refuses that leave
   too, so the rule here is what the store enforces).
3. Otherwise → `leave` (other owners remain, or the user was never one).

`canDelete` is the conjunction; one blocked workspace blocks the account.

## The store's sequencing, not this package's

The delete rides Better Auth's `/delete-user` endpoint (`user.deleteUser`
enabled in `packages/auth`), and the endpoint owns the order: password
verified FIRST (a wrong password is a 4xx before anything runs), then the
app's `beforeDelete` hook — which is where `prepareDeletion` executes — then
the user row goes, then `afterDelete` (`recordDeleted`). The Live adapter's
`deleteAccount` is therefore only the password-verified hand-off plus a
pre-check plan gate; the app supplies the hooks and the binding. Seed runs
the same sequence inline (`deleteAccount` = plan → credential check →
prepare → record) so the contract holds on both sides.

`prepareDeletion` also NULLs the two columns whose restricting foreign keys
would otherwise block the user-row delete — `audit_events.actor_user_id` and
`api_tokens.created_by_user_id` — after the workspace loop, so a blocked plan
detaches nothing. History survives as system rows; `recordDeleted` writes
`account.deleted` **actorless** (`actorUserId: null`) for the same reason:
the actor row is gone by the time it records, so the event names the account
in `targetId`.

## Binding

`AccountLifecycleBinding` is the structural port (ADR 0051's rule): the three
session-bound writes — `leaveWorkspace` (plugin `removeMember`, addressed by
membership row id), `deleteWorkspace` (plugin `deleteOrganization`), and
`deleteUser` (the core endpoint, password in, session user out). Only the app
can supply it; absent, the plan still reads and every teardown step fails
`CapabilityUnavailable` (`no_account_lifecycle_binding`).

## Anti-patterns

- Don't tear down workspaces outside `prepareDeletion` — a delete path that
  skips the hook runs against a user row whose memberships still exist.
- Don't attribute `account.deleted` to the deleted user: the FK rejects the
  insert after the row is gone.
- Don't widen the plan's step with `memberId` — the wire shape carries no
  internal row ids; the adapters keep the membership rows beside the plan.
