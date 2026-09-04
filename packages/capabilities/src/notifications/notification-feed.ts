import { Database } from '@b2b-saas-starter/db/service'
import { notifications, workspaceMembers } from '@b2b-saas-starter/db/schema'
import { and, count, desc, eq, inArray, isNull, or } from 'drizzle-orm'
import { Context, DateTime, Effect, Layer, Ref, Schema } from 'effect'
import { type CapabilityUnavailable } from '../errors.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { WorkspaceContext, type Actor } from '../workspace-context.ts'

export const Notification = Schema.Struct({
  id: Schema.String,
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
 * A user-targeted notification about the account itself rather than one
 * workspace: an impersonation, a security change. The feed is workspace-scoped
 * by design, so the write fans the message out to every workspace the user is
 * a member of — whichever one they open next shows it. A user with no
 * memberships receives nothing; the audit trail still records the event.
 */
export type NotifyUserInput = {
  readonly userId: string
  readonly title: string
  readonly message: string
}

export type NotificationFeedInterface = {
  readonly list: Effect.Effect<
    ReadonlyArray<Notification>,
    CapabilityUnavailable,
    WorkspaceContext
  >

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
   * Identity-keyed write (no `WorkspaceContext`): one unread row per workspace
   * the user is a member of, visible only to that user. Newest first on read.
   */
  readonly notifyUser: (
    input: NotifyUserInput
  ) => Effect.Effect<void, CapabilityUnavailable>

  /**
   * Records one workspace-scoped notification (ADR 0055's failed-test owner
   * notification is the first producer). Upstream emitters call this after
   * the thing they are describing has happened — the audit log is the record
   * of the change itself, this is the message a member sees in their feed.
   * Id and `createdAt` are owned here; `userId` targets one member. (The
   * feed's read model also answers broadcast rows — a `null` userId, the
   * seed fixture's shape — but no producer makes one; `record` targets a
   * member, and a broadcast producer can be added the day one exists.)
   */
  readonly record: (
    input: RecordNotificationInput
  ) => Effect.Effect<void, CapabilityUnavailable, WorkspaceContext>
}

/** What a producer hands the feed to surface a workspace message. */
export type RecordNotificationInput = {
  readonly title: string
  readonly message: string
  /** The member the message is for. */
  readonly userId: string
}

export class NotificationFeed extends Context.Service<
  NotificationFeed,
  NotificationFeedInterface
>()('@b2b-saas-starter/capabilities/NotificationFeed') {}

function visibleToActor(
  userId: SeedNotification['userId'],
  actor: Actor | null
): boolean {
  return userId === undefined || userId === null || userId === actor?.userId
}

/**
 * The in-memory feed. The rows live in a layer-scoped `Ref` so `markRead`
 * mutates them — the Seed layer is a real adapter, not a static answer sheet,
 * and Seed/Live equivalence covers the write path too.
 */
export function SeedNotificationFeed(
  seed: ReadonlyArray<SeedNotification>
): Layer.Layer<NotificationFeed> {
  return Layer.effect(NotificationFeed)(
    Effect.sync(() => {
      const rows = Ref.makeUnsafe<Array<SeedNotification>>([...seed])
      return {
        list: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const current = yield* Ref.get(rows)
          const visible: Array<Omit<SeedNotification, 'userId'>> = []
          for (const entry of current) {
            const { userId, ...notification } = entry
            if (visibleToActor(userId, ctx.actor)) {
              visible.push(notification)
            }
          }
          return visible
        }),
        unreadCount: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const current = yield* Ref.get(rows)
          return current.filter(
            (notification) =>
              !notification.read && visibleToActor(notification.userId, ctx.actor)
          ).length
        }),
        markRead: (ids) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const requested = new Set(ids)
            // `Ref.modify`, not `Ref.update` + a closure counter: modify runs
            // its function exactly once per successful state transition, so
            // the returned count is the transition's own answer and cannot
            // double-count if the runtime retries the update.
            return yield* Ref.modify(rows, (current) => {
              let marked = 0
              const next = current.map((row) => {
                if (
                  !requested.has(row.id) ||
                  !visibleToActor(row.userId, ctx.actor) ||
                  row.read
                ) {
                  return row
                }
                marked += 1
                return { ...row, read: true }
              })
              return [marked, next]
            })
          }),
        notifyUser: (input) =>
          Effect.gen(function* () {
            const id = yield* newCapabilityId('not')
            const createdAt = yield* DateTime.now
            yield* Ref.update(rows, (current) => [
              {
                id,
                title: input.title,
                message: input.message,
                createdAt: DateTime.formatIso(createdAt),
                read: false,
                userId: input.userId
              },
              ...current
            ])
          }),
        record: (input) =>
          Effect.gen(function* () {
            const row: SeedNotification = {
              id: yield* newCapabilityId('not'),
              title: input.title,
              message: input.message,
              createdAt: DateTime.formatIso(yield* DateTime.now),
              read: false,
              userId: input.userId
            }
            yield* Ref.update(rows, (current) => [row, ...current])
          })
      }
    })
  )
}

function toNotification(row: typeof notifications.$inferSelect): Notification {
  return {
    id: row.id,
    title: row.title,
    message: row.message,
    createdAt: row.createdAt,
    read: row.readAt !== null
  }
}

// Broadcast rows (userId IS NULL) are visible to everyone in the workspace;
// user-targeted rows only to that actor. Without an actor in context, only
// broadcast rows are visible.
function visibilityFilter(workspaceId: string, actor: Actor | null) {
  const workspaceScope = eq(notifications.workspaceId, workspaceId)
  if (actor === null) {
    return and(workspaceScope, isNull(notifications.userId))
  }
  return and(
    workspaceScope,
    or(isNull(notifications.userId), eq(notifications.userId, actor.userId))
  )
}

const unavailable = orUnavailable('notification-feed')

export const LiveNotificationFeed: Layer.Layer<NotificationFeed, never, Database> =
  Layer.effect(NotificationFeed)(
    Effect.gen(function* () {
      const db = yield* Database

      return {
        list: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const rows = yield* unavailable(
            db
              .select()
              .from(notifications)
              .where(visibilityFilter(ctx.workspace.id, ctx.actor))
              .orderBy(desc(notifications.createdAt))
          )
          return rows.map(toNotification)
        }),
        unreadCount: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const rows = yield* unavailable(
            db
              .select({ value: count() })
              .from(notifications)
              .where(
                and(
                  visibilityFilter(ctx.workspace.id, ctx.actor),
                  isNull(notifications.readAt)
                )
              )
          )
          return rows[0]?.value ?? 0
        }),
        markRead: (ids) =>
          Effect.gen(function* () {
            if (ids.length === 0) {
              return 0
            }
            const ctx = yield* WorkspaceContext
            const readAt = yield* DateTime.now
            // The visibility filter scopes the write exactly like the read: an
            // id the actor cannot see is never stamped. Matching ids are
            // selected first so the returned count is exact.
            const matching = yield* unavailable(
              db
                .select({ id: notifications.id })
                .from(notifications)
                .where(
                  and(
                    visibilityFilter(ctx.workspace.id, ctx.actor),
                    isNull(notifications.readAt),
                    inArray(notifications.id, [...ids])
                  )
                )
            )
            if (matching.length === 0) {
              return 0
            }
            yield* unavailable(
              db
                .update(notifications)
                .set({ readAt: DateTime.toDate(readAt).toISOString() })
                .where(
                  inArray(
                    notifications.id,
                    matching.map((row) => row.id)
                  )
                )
            )
            return matching.length
          }),
        notifyUser: (input) =>
          Effect.gen(function* () {
            const memberships = yield* unavailable(
              db
                .select({ workspaceId: workspaceMembers.workspaceId })
                .from(workspaceMembers)
                .where(eq(workspaceMembers.userId, input.userId))
            )
            if (memberships.length === 0) {
              return
            }
            const createdAt = DateTime.formatIso(yield* DateTime.now)
            const values: Array<typeof notifications.$inferInsert> = []
            for (const membership of memberships) {
              values.push({
                id: yield* newCapabilityId('not'),
                workspaceId: membership.workspaceId,
                userId: input.userId,
                title: input.title,
                message: input.message,
                readAt: null,
                createdAt
              })
            }
            yield* unavailable(db.insert(notifications).values(values))
          }),
        record: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const createdAt = yield* DateTime.now
            yield* unavailable(
              db.insert(notifications).values({
                id: yield* newCapabilityId('not'),
                workspaceId: ctx.workspace.id,
                userId: input.userId,
                title: input.title,
                message: input.message,
                createdAt: DateTime.formatIso(createdAt)
              })
            )
          })
      }
    })
  )
