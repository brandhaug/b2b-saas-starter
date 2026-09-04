import { Database } from '@b2b-saas-starter/db/service'
import { notifications, workspaceMembers } from '@b2b-saas-starter/db/schema'
import { and, count, desc, eq, inArray, isNull, or, type SQL } from 'drizzle-orm'
import { Context, DateTime, Effect, Layer, Ref, Schema } from 'effect'
import { type CapabilityUnavailable } from '../errors.ts'
import { newCapabilityId } from '../internal/ids.ts'
import {
  clampPageLimit,
  cutKeysetPage,
  type ListPageInput,
  type Page,
  seedKeysetPage
} from '../internal/keyset-cursor.ts'
import { keysetResume } from '../internal/keyset-query.ts'
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

/**
 * A notification a background job writes. Keyed by `workspaceId` rather than
 * `WorkspaceContext` because the writers (the export consumer today) run on
 * the queue, where no request context exists — the same shape as
 * `AuditEventLog.record`. `userId` targets one member; `null` broadcasts.
 */
export type NotifyInput = {
  readonly workspaceId: string
  readonly userId: string | null
  readonly title: string
  readonly message: string
}

export type NotificationFeedInterface = {
  readonly list: Effect.Effect<
    ReadonlyArray<Notification>,
    CapabilityUnavailable,
    WorkspaceContext
  >

  /**
   * The paged read the REST and MCP list surfaces serve (ADR 0057):
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
   * Identity-keyed write (no `WorkspaceContext`): one unread row per workspace
   * the user is a member of, visible only to that user. Newest first on read.
   */
  readonly notifyUser: (
    input: NotifyUserInput
  ) => Effect.Effect<void, CapabilityUnavailable>

  /** Appends one unread notification. Id and timestamp are minted here. */
  readonly notify: (input: NotifyInput) => Effect.Effect<void, CapabilityUnavailable>

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

type SeedRow = SeedNotification & { readonly workspaceId?: string }

/**
 * The rows one workspace's actor can see, stripped to the wire DTO — the
 * fixture's store-only columns (`userId`, `workspaceId`) never leave the
 * adapter, on the paged read exactly as on the whole-collection read.
 */
function visibleRows(
  rows: ReadonlyArray<SeedRow>,
  workspaceId: string,
  actor: Actor | null
): Array<Notification> {
  const visible: Array<Notification> = []
  for (const entry of rows) {
    // Fixture rows carry no workspace and belong to the seed workspace;
    // notified rows are scoped like Live's `workspaceId` column.
    if (entry.workspaceId !== undefined && entry.workspaceId !== workspaceId) {
      continue
    }
    if (visibleToActor(entry.userId, actor)) {
      visible.push({
        id: entry.id,
        title: entry.title,
        message: entry.message,
        createdAt: entry.createdAt,
        read: entry.read
      })
    }
  }
  return visible
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
      // A private copy, like the Seed audit log: the writes append without
      // mutating the caller's fixture array, and notified rows read back
      // through `list`. Notified rows carry the `workspaceId` they were
      // written for, scoped like Live's `workspaceId` column.
      const rows = Ref.makeUnsafe<Array<SeedRow>>([...seed])
      return {
        list: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          return visibleRows(yield* Ref.get(rows), ctx.workspace.id, ctx.actor)
        }),
        listPage: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            // The store's insert order is not the wire order: the shared
            // keyset helper orders `(createdAt DESC, id DESC)` and cuts the
            // page, so a page fetch behaves exactly like Live's ordered SQL
            // read — over the same visible, stripped rows `list` serves.
            return seedKeysetPage(
              visibleRows(yield* Ref.get(rows), ctx.workspace.id, ctx.actor),
              'desc',
              (row) => ({ key: row.createdAt, id: row.id }),
              input
            )
          }),
        unreadCount: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const current = yield* Ref.get(rows)
          return current.filter(
            (notification) =>
              !notification.read &&
              (notification.workspaceId === undefined ||
                notification.workspaceId === ctx.workspace.id) &&
              visibleToActor(notification.userId, ctx.actor)
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
        notify: (input) =>
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
                userId: input.userId,
                workspaceId: input.workspaceId
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
        listPage: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const limit = clampPageLimit(input?.limit)
            const conditions: Array<SQL | undefined> = [
              visibilityFilter(ctx.workspace.id, ctx.actor)
            ]
            // The SQL half of the keyset recipe lives in `keyset-query.ts`,
            // shared with every other paged Live read.
            const resume = keysetResume(
              'desc',
              { key: notifications.createdAt, id: notifications.id },
              input?.cursor
            )
            if (resume.kind === 'empty') {
              return { items: [], nextCursor: null }
            }
            if (resume.kind === 'resume') {
              conditions.push(resume.condition)
            }
            // One row past the page cap, so `cutKeysetPage` can see whether
            // the cap actually cut rows off before offering a cursor.
            const rows = yield* unavailable(
              db
                .select()
                .from(notifications)
                .where(and(...conditions))
                .orderBy(desc(notifications.createdAt), desc(notifications.id))
                .limit(limit + 1)
            )
            return cutKeysetPage(rows.map(toNotification), limit, (row) => ({
              key: row.createdAt,
              id: row.id
            }))
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
        notify: (input) =>
          Effect.gen(function* () {
            const id = yield* newCapabilityId('not')
            const createdAt = DateTime.formatIso(yield* DateTime.now)
            yield* unavailable(
              db.insert(notifications).values({
                id,
                workspaceId: input.workspaceId,
                userId: input.userId,
                title: input.title,
                message: input.message,
                readAt: null,
                createdAt
              })
            )
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
