# Notification Feed

## Purpose & Scope

Workspace-scoped notification stream plus the email fan-out that starts from it. Powers the bell icon and the notification panel in the workspace shell, and is the one place a Notification is created — producers (today: the background worker on a webhook delivery that gave up; `platform-user-admin` at impersonation start, ADR 0054; `workspace-export` when an export finishes or fails; the seed fixture) call `create` / `notifyUser`, and the instant-email queue and the daily digest both read from here. Decision record: ADR 0057.

Split into three modules (the standard seam): `notification-feed.ts` (contract, pure helpers), `notification-feed.seed.ts`, `notification-feed.live.ts`. `notification-fan-out.ts` holds the instant enqueue both adapters share, `notification-email-queue.ts` the queue message schema and binding port the background consumer imports, and `notification-feed.contract.ts` the mark-read cases both adapters run (`index.test.ts`, `notification-feed.live.test.ts`); the email and digest reads have their own live suite in `notification-email.live.test.ts`.

## Public surface

- `Notification` — `{ id, kind, title, message, createdAt, read }`. `read` is derived from `readAt !== null` on the row; the wire shape hides the timestamp. `kind` is from `notificationKinds` (`packages/db/src/enums.ts`).
- `NotificationFeed.list` / `unreadCount` — for the current `WorkspaceContext`, newest first; `unreadCount` is a `count(*)` query.
- `NotificationFeed.markRead(ids)` — stamps the given unread ids read and returns how many rows changed. Idempotent: unknown, foreign, invisible, or already-read ids change nothing. The visibility filter is the read's filter, so the write never touches a row the actor cannot see. Input type: `MarkNotificationsReadInput` (`{ ids: string[] }`). `loadForEmail` and the digest treat a read row as delivered, so marking read in the app also stops its email.
- `NotificationFeed.create({ workspaceId, userId?, kind, title, message })` — persists the row, then enqueues one `NotificationEmailQueueMessage` per recipient whose channel for `kind` resolves to `instant` (`NotificationPreferences.resolve`). Recipients are the target user, or every workspace member for a broadcast (`userId: null`). **Identity-keyed by `workspaceId`** rather than reading `WorkspaceContext`: the background worker is a producer and holds a workspace id, not a slug — the same footing as `recordTerminalDeliveryAttempt`. Route-side producers pass `ctx.workspace.id`.
- `NotificationFeed.notifyUser({ userId, kind, title, message })` — **identity-keyed write**, no `WorkspaceContext`: inserts one unread, user-targeted row per workspace the user is a member of (`workspaceMembers`), so whichever workspace they open next shows it, then enqueues at most one instant email — the extra rows are feed copies of the same event, not additional messages. A user with no memberships receives nothing. Used by `platform-user-admin` at impersonation start.
- `NotificationFeed.loadForEmail(notificationId, recipientUserId)` — the instant consumer's read: the Notification, the recipient's `{ userId, email, name }`, and the workspace `{ slug, name }` (null for account-level rows). `null` when the row is gone, already read, or not visible to that recipient.
- `NotificationFeed.listDigestCandidates({ since, until })` — every unread (Notification, recipient) pair created in `[since, until)`; a broadcast appears once per member. Whether a pair lands in the digest is the recipient's preference, resolved by the digest job.
- **Actor scoping:** rows with `userId = NULL` are workspace broadcasts, visible to everyone; rows with a `userId` are only visible to that actor. Without an actor in context, only broadcast rows are returned. Both adapters apply the same filter (`visibleToActor`).
- Every method can fail with `CapabilityUnavailable` (503) when D1 is unreachable. The enqueue never fails `create`: no binding means no enqueue, a queue rejection annotates the wide event (`notificationEmailEnqueue: 'failed'`).

## The permission decision: `notification:read`, not a write action

The role matrix has no `notification:write` action, and `markRead` deliberately does not add one (that would be a change to `@b2b-saas-starter/authz`, not this capability). Marking read is the actor **consuming their own feed** — the write side of `notification:read` — so the web server fn composes `requireWorkspacePermission({ notification: ['read'] })`, the same statement as the page gate. The capability itself stays authorization-free (invariant 2). `create` has no permission at all: its callers are trusted producers (background jobs, other capabilities), never a request acting on a user's behalf.

**Broadcast caveat (accepted trade):** `readAt` sits on the shared row, so marking a broadcast row read marks it for the whole workspace — the table has no per-actor read state — and also drops it from every member's digest. Per-actor read state (a join table) is the fix if this ever matters; do not silently re-derive `read` client-side to fake it.

## Storage

- Table: `notifications` — `workspaceId` and `userId` nullable FKs, `kind` (enum, default `announcement`), `title`, `message`, `readAt`, `createdAt`. The visibility filter is shared between `list`, `unreadCount`, and `markRead`.
- `markRead` selects the matching unread ids first, then updates by id — the returned count is exact and the write is a single `UPDATE … WHERE id IN (…)`.
- Live `create` reads recipients from `user` (targeted) or `workspace_members ⋈ user` (broadcast). `listDigestCandidates` is two queries — targeted rows joined to `user`, broadcast rows joined through `workspace_members` — because a row with no workspace and no user reaches nobody.
- The Seed adapter takes `{ workspace, members }` so it can fan a broadcast out the same way; `create` for any other workspace id persists but reaches nobody.

## Status & follow-ups

- Consider a `severity` field (`'info' | 'warning' | 'critical'`) once notification volume grows. The bell badge will want to differentiate.
- Per-actor read state for broadcast rows (see the caveat above).
- More producers: `api_token.created` / `.revoked` from `ApiTokenRegistry`, `workspace_member.role_changed` from `WorkspaceMembership`, `billing.plan_changed` from `Billing.applyProviderEvent`. The kinds and templates exist; only the `create` calls are missing.

## Anti-patterns

- Don't push transient UI toasts through this capability. Notifications are persistent — toasts belong in component state (`sonner`).
- Don't return `readAt` raw. The DTO collapses it to a boolean by design so the wire shape stays cacheable.
- Don't send email from inside the capability. `create` enqueues ids; rendering and sending belong to the background worker, which re-reads preferences at send time.
- Don't put an address or a body on the queue message. Ids only — see `notification-email-queue.ts`.
- Don't add a `notification:write` permission for feed writes. The decision above is recorded; revisit it only with a real second write behaviour (authoring, deleting).
- Don't give `notifyUser` a `workspaceId` parameter. It is for account-level notices; a workspace-scoped producer should read `WorkspaceContext` in a method of its own.

## Paging (ADR 0057)

`listPage` serves the REST/MCP list surface: newest-first on `(createdAt DESC, id DESC)` through the shared `internal/keyset-cursor.ts` recipe, `limit` clamped into `[1, 200]`, `nextCursor` null on the last page. An undecodable cursor yields an empty page. `list` stays the whole-collection read the app's own pages render — don't route the API surfaces through it.
