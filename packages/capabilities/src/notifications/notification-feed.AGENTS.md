# Notification feed

The one place a Notification row is created (ADR 0061). Producers call `create` / `record` / `notifyUser`; the instant-email queue and the daily digest read from here.

## Contracts

- `create` is keyed by `workspaceId`, since background producers hold an id. It persists the row, then enqueues one `NotificationEmailQueueMessage` per recipient whose channel resolves to `instant`; `userId: null` broadcasts.
- `notifyUser` is identity-keyed and inserts one row per workspace the user belongs to, but enqueues at most one email: the extra rows are copies of one event.
- `loadForEmail` and the digest skip a read row, so marking read in the app also stops its email.
- `userId = NULL` rows are broadcasts; a `userId` restricts the row to that actor, and with no actor in context only broadcasts return (`visibleToActor`, shared by the reads and `markRead`).
- The enqueue never fails `create`: no binding means no enqueue, a rejection annotates the wide event.

## Pitfalls

- `markRead` sits under `notification:read`, the actor consuming their own feed; a `notification:write` action would mean changing `@b2b-saas-starter/authz`. `create` is ungated, its callers being trusted producers.
- `readAt` is on the shared row, so marking a broadcast read marks it workspace-wide and drops it from every member's digest. Per-actor read state would require a join table; client-side changes cannot correct this.

## Boundaries

- No address or body on the queue message, no email sent from here; the worker re-reads preferences at send time.
- No `workspaceId` parameter on `notifyUser`; it is for account-level notices.

> TODO(intent): severity field, per-actor read state, producers for tokens, role changes, plan changes.

- `prepareWorkspaceOwners` prepares conditional notification statements for a producer-owned D1 batch. The producer calls `publish` only after a successful commit. Workspace suspension uses it so a failed notification insert cannot leave an unannounced state change. Seed prepares in-memory rows and publishes them inside the successful transition.
