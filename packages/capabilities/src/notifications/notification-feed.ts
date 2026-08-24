import { Database } from '@b2b-saas-starter/db/src/service.ts'
import { notifications } from '@b2b-saas-starter/db/src/schema.ts'
import { Context, DateTime, Effect, Layer, Schema } from 'effect'
import { and, count, desc, eq, isNull, or } from 'drizzle-orm'
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

/**
 * Seed rows may carry an optional target user id so tests can exercise the
 * same actor scoping the Live layer applies. It is stripped from the DTO.
 */
export type SeedNotification = Notification & {
  readonly userId?: string | null
}

export type NotificationFeedInterface = {
  readonly list: Effect.Effect<
    readonly Notification[],
    CapabilityUnavailable,
    WorkspaceContext
  >

  readonly unreadCount: Effect.Effect<number, CapabilityUnavailable, WorkspaceContext>

  /**
   * Trusted-emitter surface (background worker, server functions): insert one
   * broadcast row. `workspaceId` is taken explicitly because the queue
   * consumer has no `WorkspaceContext`; the row carries no `userId`, so every
   * member of the workspace — admins included — sees it.
   */
  readonly record: (input: {
    readonly workspaceId: string
    readonly title: string
    readonly message: string
  }) => Effect.Effect<void, CapabilityUnavailable>
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

export function SeedNotificationFeed(
  seed: readonly SeedNotification[]
): Layer.Layer<NotificationFeed> {
  // Own copy: `record` appends, and the caller's array must not change.
  const rows: Array<SeedNotification> = [...seed]
  return Layer.succeed(NotificationFeed)({
    list: Effect.gen(function* () {
      const ctx = yield* WorkspaceContext
      const visible: Array<Omit<SeedNotification, 'userId'>> = []
      for (const entry of rows) {
        const { userId, ...notification } = entry
        if (visibleToActor(userId, ctx.actor)) visible.push(notification)
      }
      return visible
    }),
    unreadCount: Effect.gen(function* () {
      const ctx = yield* WorkspaceContext
      return rows.filter(
        (notification) =>
          !notification.read && visibleToActor(notification.userId, ctx.actor)
      ).length
    }),
    record: (input) =>
      Effect.gen(function* () {
        const now = yield* DateTime.now
        rows.push({
          ...input,
          id: `ntf_seed_${rows.length + 1}`,
          read: false,
          createdAt: DateTime.formatIso(now)
        })
      })
  })
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
        record: (input) =>
          Effect.gen(function* () {
            const createdAt = yield* DateTime.now
            yield* unavailable(
              db.insert(notifications).values({
                id: yield* newCapabilityId('ntf'),
                workspaceId: input.workspaceId,
                title: input.title,
                message: input.message,
                createdAt: DateTime.formatIso(createdAt)
              })
            )
          })
      }
    })
  )
