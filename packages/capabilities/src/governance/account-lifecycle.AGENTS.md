# Account Lifecycle

## Purpose & Scope

Self-service account deletion and the workspace teardown it implies (ADR 0059). Identity-keyed throughout: the actor asks about every workspace they belong to at once, before one is selected.

## Entry Points & Contracts

- `planDeletion(userId)` never mutates, so the account page can name the workspaces needing an owner first.
- `prepareDeletion(userId)` runs the teardown (leave, delete, detach) and fails `AccountDeletionBlocked` (409, carrying the blocking workspaces) without touching anything if a step is blocked.
- `deleteAccount` plans, gates, then hands off to the store; a refusal there (wrong password, no credential) is `AccountDeletionRejected` (409).
- `planAccountDeletion` is the shared rule, per membership, in precedence order: sole member gives `delete_workspace`, sole owner of a shared workspace `blocked_sole_owner` (the plugin refuses that leave too), otherwise `leave`. One blocked workspace blocks the account; `deletionMetadata` yields counts, never workspace names.
- Audits `workspace.deleted` with `workspaceId: null` (the real id cascades away), `workspace_member.removed` with `metadata.reason: 'account_deleted'`, and an actorless `account.deleted` naming the account in `targetId`.
- Without an `AccountLifecycleBinding` the plan still reads; teardown fails `CapabilityUnavailable('no_account_lifecycle_binding')`.

## Patterns & Pitfalls

- The store owns the order: password verified first, then the app's `beforeDelete` hook running `prepareDeletion` (`apps/web/src/lib/server/account-delete-hooks.ts`), then the user row, then `afterDelete` calling `recordDeleted`. Live `deleteAccount` is only the pre-check plus hand-off.
- `prepareDeletion` NULLs `audit_events.actor_user_id` and `api_tokens.created_by_user_id` after the workspace loop, because those restricting foreign keys block the user-row delete and a blocked plan must detach nothing.
- The seed fixture has no credentials: any non-empty password passes, the empty string models rejection.

## Anti-patterns

- No teardown outside `prepareDeletion`; skipping the hook leaves memberships behind.
- No attributing `account.deleted` to the deleted user or `workspace.deleted` to its workspace: the FK rejects the first, the second cascades the event away.
