# Account lifecycle

Self-service account deletion and the workspace teardown it implies (ADR 0059). Identity-keyed throughout: the actor asks about every workspace they belong to at once, before one is selected.

## Contracts

- `prepareDeletion(userId)` runs the teardown (leave, delete, detach) and fails `AccountDeletionBlocked` (409, carrying the blocking workspaces) without touching anything if a step is blocked.
- `deleteAccount` plans, gates, then hands off to the store; a refusal there (wrong password, no credential) is `AccountDeletionRejected` (409).
- `planAccountDeletion` handles sole-member suspension and billing blockers before `delete_workspace`, then shared-workspace sole ownership before `leave`. One blocked workspace blocks the account; `deletionMetadata` yields counts, never workspace names. Both adapters consult `Billing.workspaceDeletionAllowed` before teardown.
- Audits `workspace.deleted` with `workspaceId: null` (the real id cascades away), `workspace_member.removed` with `metadata.reason: 'account_deleted'`, and an actorless `account.deleted` naming the account in `targetId`.

Assistant conversation cleanup addresses are fenced before account or implied Workspace deletion. Tombstones survive parent removal so the background worker can retry object shutdown and storage deletion.

## Pitfalls

- The store owns the order: password verified first, then the app's `beforeDelete` hook running `prepareDeletion` (`apps/web/src/lib/server/account-delete-hooks.ts`), then the user row, then `afterDelete` calling `recordDeleted`. Live `deleteAccount` is only the pre-check plus hand-off.
- Better Auth's privileged `admin/remove-user` endpoint has the administrator's session while the plan targets another user, so its authorized hook uses `makeAdminAccountLifecycleBinding` from `account-lifecycle-admin.live.ts`. That capability-owned adapter is the isolated exception to the plugin-backed write rule: the endpoint has already performed the admin role check, and reusing the admin session would mutate the wrong account. The web layer only supplies the D1 binding and selects this adapter for that endpoint.
- After the workspace loop, `prepareDeletion` detaches audit actors, API-token creators and OAuth-client owners. It deletes the account's OAuth consent and tokens in dependency order, preserving other users' grants to shared clients. A blocked plan changes none of these rows.
- Implied workspace deletion uses `withWorkspaceDeletionFence`, like explicit deletion. Preserve the plugin hand-off and the database owner/billing guards.
- The seed fixture has no credentials: any non-empty password passes, the empty string models rejection.

## Boundaries

- No teardown outside `prepareDeletion`; skipping the hook leaves memberships behind.
- No attributing `account.deleted` to the deleted user or `workspace.deleted` to its workspace: the FK rejects the first, the second cascades the event away.
