import { Context, Effect, Layer, Schema } from 'effect'
import { and, count, desc, eq, isNull, or } from 'drizzle-orm'
import { Database, notifications } from '@b2b-saas-starter/db'
import type { CapabilityUnavailable } from '../errors.ts'
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

export type NotificationFeedShape = {
  readonly list: Effect.Effect<
    readonly Notification[],
    CapabilityUnavailable,
    WorkspaceContext
  >
  readonly unreadCount: Effect.Effect<number, CapabilityUnavailable, WorkspaceContext>
}

export class NotificationFeed extends Context.Service<
  NotificationFeed,
  NotificationFeedShape
>()('@b2b-saas-starter/capabilities/NotificationFeed') {}

const visibleToActor = (notification: SeedNotification, actor: Actor | null): boolean =>
  notification.userId === undefined ||
  notification.userId === null ||
  notification.userId === actor?.userId

export const SeedNotificationFeed = (
  seed: readonly SeedNotification[]
): Layer.Layer<NotificationFeed> =>
  Layer.succeed(NotificationFeed)({
    list: Effect.gen(function* () {
      const ctx = yield* WorkspaceContext
      return seed
        .filter((notification) => visibleToActor(notification, ctx.actor))
        .map(({ userId: _userId, ...notification }) => notification)
    }),
    unreadCount: Effect.gen(function* () {
      const ctx = yield* WorkspaceContext
      return seed.filter(
        (notification) => !notification.read && visibleToActor(notification, ctx.actor)
      ).length
    })
  })

const unavailable = orUnavailable('notification-feed')

export const LiveNotificationFeed: Layer.Layer<NotificationFeed, never, Database> =
  Layer.effect(NotificationFeed)(
    Effect.gen(function* () {
      const db = yield* Database

      const toNotification = (
        row: typeof notifications.$inferSelect
      ): Notification => ({
        id: row.id,
        title: row.title,
        message: row.message,
        createdAt: row.createdAt,
        read: row.readAt !== null
      })

      // Broadcast rows (userId IS NULL) are visible to everyone in the
      // workspace; user-targeted rows only to that actor. Without an actor in
      // context, only broadcast rows are visible.
      const visibilityFilter = (workspaceId: string, actor: Actor | null) =>
        and(
          eq(notifications.workspaceId, workspaceId),
          actor === null
            ? isNull(notifications.userId)
            : or(isNull(notifications.userId), eq(notifications.userId, actor.userId))
        )

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
