# 0059 — Account deletion on the store's delete endpoint with a capability-owned teardown

Date: 2026-09-04

## Status

Accepted

## Context

Self-service account deletion has an ordering problem that plain "delete the
row" features do not. A user's account row is referenced by their
**Workspace** memberships — and the memberships decide what must happen
first:

- A workspace where the user is the only **Member** should be deleted with
  the account.
- A workspace where the user is the only **owner** among several members
  must **block** the deletion: leaving would strand the other members, and
  Better Auth's organization plugin refuses that leave too.
- Everywhere else the membership can simply be removed.

On top of the rule, two storage facts constrain the sequencing. The schema
gives `audit_events.actor_user_id` and `api_tokens.created_by_user_id`
**restricting** foreign keys to `user.id` (no cascade, on purpose — history
must survive its subject), so those references must be detached before the
user row can be deleted at all. And the password must be verified **before**
any teardown, or a wrong password destroys workspaces around an account that
is still there.

The repo already owns a password-verified, hook-sequenced delete: Better
Auth's `delete-user` endpoint, which verifies the credential, runs a
`beforeDelete` hook, removes the user row, and runs `afterDelete` — but only
when `user.deleteUser.enabled` is set. The alternative was to sequence the
steps ourselves in a server function (verify the password somehow, tear down,
then delete the row), which would re-implement the endpoint's verification
and leave windows between the steps.

## Decision

1. **The store owns the sequence; the capability owns the rule.**
   `AccountLifecycle` (`packages/capabilities/src/governance/account-lifecycle`)
   owns the ownership rule (`planAccountDeletion`), the teardown
   (`prepareDeletion`: leave/delete workspaces through the plugin binding,
   audit each step, detach the restricting references), and the actorless
   `account.deleted` record. The delete itself hands to Better Auth's
   `delete-user` endpoint through the same structural binding port the other
   plugin-backed capabilities declare (ADR 0051).

2. **The endpoint is enabled only when its teardown exists.** `packages/auth`
   gates `user.deleteUser.enabled` on `AuthConfig.userDeleteHooks` being
   supplied. There is no configuration where the endpoint runs without the
   `beforeDelete` teardown — the dangerous default is unrepresentable rather
   than documented.

3. **The app supplies the hooks**, in `apps/web/src/lib/server/
account-delete-hooks.ts`: `beforeDelete` runs `prepareDeletion` (a failure
   aborts the delete — fail-closed), `afterDelete` runs `recordDeleted` and
   sends the deletion email, both best-effort because the account row is
   already gone. The computed plan is handed between the hooks keyed by the
   request, the one object exactly one delete's hooks share.

4. **The `account.deleted` Audit Event is actorless.** `recordDeleted` writes
   `actorUserId: null` and names the account in `targetId`: the actor row is
   gone by the time the event records, and the FK would reject the insert
   otherwise. The same reasoning keeps `prepareDeletion`'s detaching updates
   **after** the workspace loop, so a blocked plan detaches nothing.

5. **Seed and Live implement the same contract** (capabilities invariant 4),
   with the shared contract cases running against both and the mixed
   happy-path covered per adapter, because the one-workspace seed fixture
   cannot express a second workspace.

## Consequences

- A wrong password can never tear down a workspace: verification happens in
  the endpoint before any hook runs.
- The race between the pre-check plan (the UI's) and the hook's re-check is
  fail-closed: a plan that turned blocked between the two checks aborts the
  delete inside `beforeDelete` with the account intact.
- `account.deleted` events do not name an actor; consumers read `targetId`.
  This matches the existing system-event pattern for `workspace.deleted`
  (ADR 0051's non-atomicity family: some events cannot share their
  subject's fate).
- The delete-user endpoint, the plugin's leave/delete endpoints, and the
  plan read are all session-bound, so the surface stays Reference
  Application only — the API Worker serves none of it, same as invitations.
- Deletion emails reuse the provider-light `EmailDispatcher`; local
  development without provider configuration delivers to the log.
