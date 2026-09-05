import {
  NotificationFeed,
  type Notification
} from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import { Effect } from 'effect'

import { runWorkspaceCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { requireWorkspacePermission } from './authorize'
import {
  type ListNotificationsInput,
  type MarkNotificationsReadInput
} from './notifications'

/**
 * The notification-feed reads and their server-only wiring, reached only
 * through dynamic `import()` inside the handlers of `notifications.ts` (see
 * apps/web/AGENTS.md for the split). The whole-collection `list` read serves
 * the workspace bell panel; the paged REST and MCP surfaces read `listPage`.
 */

export async function listNotificationsHandler(
  input: ListNotificationsInput
): Promise<ReadonlyArray<Notification>> {
  const session = await requireRequestSession()
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.flatMap(NotificationFeed, (feed) => feed.list),
    { userId: session.user.id }
  )
}

export async function markNotificationsReadHandler(
  input: MarkNotificationsReadInput
): Promise<number> {
  const session = await requireRequestSession()
  // Same permission as the read: marking read is the actor consuming their
  // own feed, and the capability's visibility filter scopes the write to
  // rows the actor can see. The decision is recorded in the capability's
  // intent node.
  return runWorkspaceCapabilities(
    input.workspaceSlug,
    Effect.gen(function* () {
      yield* requireWorkspacePermission({ notification: ['read'] })
      const feed = yield* NotificationFeed
      return yield* feed.markRead(input.ids)
    }),
    { userId: session.user.id }
  )
}
