import { Database } from '@b2b-saas-starter/db/service'
import { notifications } from '@b2b-saas-starter/db/schema'
import { Context, Effect, Layer, Schema } from 'effect'
import { and, count, desc, eq, isNull, or } from 'drizzle-orm'
import { type CapabilityUnavailable } from '../errors.ts'
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
  return Layer.succeed(NotificationFeed)({
    list: Effect.gen(function* () {
      const ctx = yield* WorkspaceContext
      const visible: Array<Omit<SeedNotification, 'userId'>> = []
      for (const entry of seed) {
        const { userId, ...notification } = entry
        if (visibleToActor(userId, ctx.actor)) visible.push(notification)
      }
      return visible
    }),
    unreadCount: Effect.gen(function* () {
      const ctx = yield* WorkspaceContext
      return seed.filter(
        (notification) =>
          !notification.read && visibleToActor(notification.userId, ctx.actor)
      ).length
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
        })
      }
    })
  )
