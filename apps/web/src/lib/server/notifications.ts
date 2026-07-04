import { createServerFn } from '@tanstack/react-start'
import { Effect, Schema } from 'effect'
import { NotificationFeed } from '@b2b-saas-starter/capabilities'
import { runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'

const ListNotificationsInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString
})

const decodeInput = Schema.decodeUnknownSync(ListNotificationsInput)

export const listNotificationsServerFn = createServerFn({ method: 'GET' })
  .validator((input: unknown) => decodeInput(input))
  .handler(async ({ data }) => {
    const session = await requireRequestSession()
    return runWorkspaceCapabilities(
      data.workspaceSlug,
      Effect.gen(function* () {
        const feed = yield* NotificationFeed
        return yield* feed.list
      }),
      { userId: session.user.id }
    )
  })

export const notificationsQueryKey = (workspaceSlug: string) =>
  ['notifications', workspaceSlug] as const
