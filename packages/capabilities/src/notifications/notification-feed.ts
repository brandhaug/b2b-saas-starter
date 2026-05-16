import { Context, Effect, Layer, Schema } from 'effect'
import { desc, eq } from 'drizzle-orm'
import { Database, notifications } from '@b2b-saas-starter/db'
import { WorkspaceContext } from '../workspace-context.ts'

export const Notification = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  message: Schema.String,
  createdAt: Schema.String,
  read: Schema.Boolean
})
export type Notification = typeof Notification.Type

export type NotificationFeedShape = {
  readonly list: Effect.Effect<readonly Notification[], never, WorkspaceContext>
  readonly unreadCount: Effect.Effect<number, never, WorkspaceContext>
}

export class NotificationFeed extends Context.Service<
  NotificationFeed,
  NotificationFeedShape
>()('@b2b-saas-starter/capabilities/NotificationFeed') {}

export const SeedNotificationFeed = (
  seed: readonly Notification[]
): Layer.Layer<NotificationFeed> =>
  Layer.succeed(NotificationFeed)({
    list: Effect.succeed(seed),
    unreadCount: Effect.succeed(
      seed.filter((notification) => !notification.read).length
    )
  })

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

      return {
        list: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const rows = yield* Effect.promise(() =>
            db
              .select()
              .from(notifications)
              .where(eq(notifications.workspaceId, ctx.workspace.id))
              .orderBy(desc(notifications.createdAt))
          )
          return rows.map(toNotification)
        }),
        unreadCount: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const rows = yield* Effect.promise(() =>
            db
              .select()
              .from(notifications)
              .where(eq(notifications.workspaceId, ctx.workspace.id))
          )
          return rows.filter((row) => row.readAt === null).length
        })
      }
    })
  )
