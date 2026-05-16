import { createServerFn } from '@tanstack/react-start'
import { Effect, Schema } from 'effect'
import { NotificationFeed } from '@b2b-saas-starter/capabilities'
import { runWorkspaceCapabilities } from '../capabilities'

const ListNotificationsInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString
})

const decodeInput = Schema.decodeUnknownSync(ListNotificationsInput)

export const listNotificationsServerFn = createServerFn({ method: 'GET' })
  .inputValidator((input: unknown) => decodeInput(input))
  .handler(({ data }) =>
    runWorkspaceCapabilities(
      data.workspaceSlug,
      Effect.gen(function* () {
        const feed = yield* NotificationFeed
        return yield* feed.list
      })
    )
  )

export const notificationsQueryKey = (workspaceSlug: string) =>
  ['notifications', workspaceSlug] as const
