import { Context, type Effect, Schema } from 'effect'
import { type CapabilityUnavailable } from '../errors.ts'
import { type ListPageInput, type Page } from '../internal/keyset-cursor.ts'
import { type WorkspaceContext, type Actor } from '../workspace-context.ts'
import { type NotificationEmailQueueBinding } from './notification-email-queue.ts'
import { NotificationKind } from './notification-kinds.ts'

export const Notification = Schema.Struct({
  id: Schema.String,
  kind: NotificationKind,
  title: Schema.String,
  message: Schema.String,
  createdAt: Schema.String,
  read: Schema.Boolean
})
export type Notification = typeof Notification.Type

/** The wire input of `markRead`: the unread ids the actor is marking read. */
export const MarkNotificationsReadInput = Schema.Struct({
  ids: Schema.Array(Schema.String)
})
export type MarkNotificationsReadInput = typeof MarkNotificationsReadInput.Type

/**
 * Seed rows may carry an optional target user id so tests can exercise the
 * same actor scoping the Live layer applies. It is stripped from the DTO.
 */
export type SeedNotification = Notification & {
  readonly userId?: string | null
}

/**
 * What a producer hands `create`. Identity-keyed by `workspaceId` rather than
 * read off `WorkspaceContext`, because the background worker is a producer
 * too (webhook deliveries that gave up) and it holds a workspace id, not a
 * slug — the same footing as `recordTerminalDeliveryAttempt`. Route-side
 * producers pass `ctx.workspace.id`. `userId` null means a workspace
 * broadcast every member sees.
 */
export type CreateNotificationInput = {
  readonly workspaceId: string
  readonly userId?: string | null
  readonly kind: NotificationKind
  readonly title: string
  readonly message: string
}

/** What a producer hands `record` — the feed-only workspace message. */
export type RecordNotificationInput = {
  readonly title: string
  readonly message: string
  /** The member the message is for. */
  readonly userId: string
}

/**
 * A user-targeted notification about the account itself rather than one
 * workspace: an impersonation, a security change. The feed is workspace-scoped
 * by design, so the write fans the message out to every workspace the user is
 * a member of — whichever one they open next shows it. A user with no
 * memberships receives nothing; the audit trail still records the event. The
 * email fan-out sends one message, not one per copy: the extra rows are feed
 * copies of the same event.
 */
export type NotifyUserInput = {
  readonly userId: string
  readonly kind: NotificationKind
  readonly title: string
  readonly message: string
}

/** Who an email about a Notification goes to. */
export type NotificationRecipient = {
  readonly userId: string
  readonly email: string
  readonly name: string
}

export type NotificationWorkspace = {
  readonly slug: string
  readonly name: string
}

/**
 * Everything the instant-email consumer needs to render one message, looked
 * up from the two ids the queue message carries. `null` when the Notification
 * is gone, was read in the meantime, or the recipient can no longer see it.
 */
export type NotificationEmailContext = {
  readonly notification: Notification
  readonly recipient: NotificationRecipient
  readonly workspace: NotificationWorkspace | null
}

/**
 * One (Notification, recipient) pair the digest may include: unread, created
 * inside the window, and visible to the recipient — a broadcast row appears
 * once per member. Whether the recipient actually wants it in the digest is
 * the preference's call, resolved by the digest job, not here.
 */
export type DigestCandidate = NotificationEmailContext

export type DigestWindow = {
  /** ISO timestamp, inclusive. */
  readonly since: string
  /** ISO timestamp, exclusive. */
  readonly until: string
}

export type NotificationFeedInterface = {
  readonly list: Effect.Effect<
    ReadonlyArray<Notification>,
    CapabilityUnavailable,
    WorkspaceContext
  >

  /**
   * The paged read the REST and MCP list surfaces serve (ADR 0061):
   * newest-first on `(createdAt DESC, id DESC)`, one bounded `Page` at a
   * time. `list` stays for the whole-collection reads the app's own pages
   * render — feeds are small by construction there.
   */
  readonly listPage: (
    input?: ListPageInput
  ) => Effect.Effect<Page<Notification>, CapabilityUnavailable, WorkspaceContext>

  readonly unreadCount: Effect.Effect<number, CapabilityUnavailable, WorkspaceContext>

  /**
   * Stamps the given unread ids read for the current context and returns how
   * many rows changed. Ids that are unknown, foreign, invisible to the actor,
   * or already read are ignored — the call is idempotent. Marking a broadcast
   * row read stamps the shared row (the table has no per-actor read state);
   * the write is gated upstream by the same `notification:read` permission as
   * the read, because it is the actor consuming their own feed.
   */
  readonly markRead: (
    ids: ReadonlyArray<string>
  ) => Effect.Effect<number, CapabilityUnavailable, WorkspaceContext>

  /**
   * Persists the Notification, then enqueues one instant-email message per
   * recipient whose channel for `kind` resolves to `instant`. The enqueue is
   * best-effort: without a queue binding nothing is enqueued, and a queue
   * outage annotates the wide event rather than failing the producer — the
   * Notification itself is the durable record.
   */
  readonly create: (
    input: CreateNotificationInput
  ) => Effect.Effect<Notification, CapabilityUnavailable>

  /**
   * Records one workspace-scoped notification (ADR 0069's failed-test owner
   * notification is the first producer). Upstream emitters call this after
   * the thing they are describing has happened — the audit log is the record
   * of the change itself, this is the message a member sees in their feed.
   * Id and `createdAt` are owned here; `userId` targets one member. Unlike
   * `create`, no email fan-out runs: the message is feed-only. (The feed's
   * read model also answers broadcast rows — a `null` userId, the seed
   * fixture's shape — but no producer makes one; `record` targets a member,
   * and a broadcast producer can be added the day one exists.)
   */
  readonly record: (
    input: RecordNotificationInput
  ) => Effect.Effect<void, CapabilityUnavailable, WorkspaceContext>

  /**
   * Identity-keyed write (no `WorkspaceContext`): one unread row per workspace
   * the user is a member of, visible only to that user, then at most one
   * instant email for the event (never one per copy). A user with no
   * memberships receives nothing.
   */
  readonly notifyUser: (
    input: NotifyUserInput
  ) => Effect.Effect<void, CapabilityUnavailable>

  /** The instant-email consumer's read. */
  readonly loadForEmail: (
    notificationId: string,
    recipientUserId: string
  ) => Effect.Effect<NotificationEmailContext | null, CapabilityUnavailable>

  /** The digest job's read: every unread pair inside the window. */
  readonly listDigestCandidates: (
    window: DigestWindow
  ) => Effect.Effect<ReadonlyArray<DigestCandidate>, CapabilityUnavailable>
}

export class NotificationFeed extends Context.Service<
  NotificationFeed,
  NotificationFeedInterface
>()('@b2b-saas-starter/capabilities/NotificationFeed') {}

/** Options both adapters take: the optional producer binding. */
export type NotificationFeedOptions = {
  readonly emailQueue?: NotificationEmailQueueBinding | undefined
}

export function visibleToActor(
  userId: SeedNotification['userId'],
  actor: Actor | null
): boolean {
  return userId === undefined || userId === null || userId === actor?.userId
}

/** Whether `createdAt` falls inside `[since, until)`; ISO strings compare lexically. */
export function inDigestWindow(createdAt: string, window: DigestWindow): boolean {
  return createdAt >= window.since && createdAt < window.until
}
