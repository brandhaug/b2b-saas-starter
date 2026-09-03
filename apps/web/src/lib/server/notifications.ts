import { NotificationFeed } from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import { createServerFn } from '@tanstack/react-start'
import { Effect, Schema } from 'effect'
import { runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission } from './authorize'

const ListNotificationsInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString
})

// The schema decoder IS the boundary contract: passing it as the validator
// keeps the untyped wire value inside `decodeUnknownSync` and hands the handler
// the decoded domain type.
const decodeInput = Schema.decodeUnknownSync(ListNotificationsInput)

export const listNotificationsServerFn = createServerFn({ method: 'GET' })
  .validator((input) => decodeInput(input))
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

const MarkNotificationsReadInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  // All constraints in the schema: an empty array decodes fine and marks
  // nothing; unknown or invisible ids are ignored by the capability itself.
  ids: Schema.Array(Schema.String)
})

const decodeMarkReadInput = Schema.decodeUnknownSync(MarkNotificationsReadInput)

export const markNotificationsReadServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeMarkReadInput(input))
  .handler(async ({ data }) => {
    const session = await requireRequestSession()
    // Same permission as the read: marking read is the actor consuming their
    // own feed, and the capability's visibility filter scopes the write to
    // rows the actor can see. The decision is recorded in the capability's
    // intent node.
    return runWorkspaceCapabilities(
      data.workspaceSlug,
      Effect.gen(function* () {
        yield* requireWorkspacePermission({ notification: ['read'] })
        const feed = yield* NotificationFeed
        return yield* feed.markRead(data.ids)
      }),
      { userId: session.user.id }
    )
  })

export function notificationsQueryKey(
  workspaceSlug: string
): readonly ['notifications', string] {
  return ['notifications', workspaceSlug]
}
