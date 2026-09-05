import { type Notification } from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'

/**
 * The notification-feed server functions, in a **client-safe** module — the
 * client-safe half of the `notifications.effects.ts` split; see
 * apps/web/AGENTS.md for the rule and `scripts/assert-client-boundary.mjs`
 * for the enforcement. Each input is written once, as its Effect Schema: the
 * validator is the single strict decode, and the derived type types both the
 * client stub and the effects handler.
 */

const ListNotificationsInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString
})

const MarkNotificationsReadInput = Schema.Struct({
  workspaceSlug: Schema.NonEmptyString,
  // All constraints in the schema: an empty array decodes fine and marks
  // nothing; unknown or invisible ids are ignored by the capability itself.
  ids: Schema.Array(Schema.String)
})

export type ListNotificationsInput = typeof ListNotificationsInput.Type
export type MarkNotificationsReadInput = typeof MarkNotificationsReadInput.Type

export const listNotificationsServerFn = createServerFn({ method: 'GET' })
  .validator(Schema.decodeUnknownSync(ListNotificationsInput))
  .handler(async ({ data }): Promise<ReadonlyArray<Notification>> => {
    const { listNotificationsHandler } = await import('./notifications.effects')
    return listNotificationsHandler(data)
  })

export const markNotificationsReadServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(MarkNotificationsReadInput))
  .handler(async ({ data }): Promise<number> => {
    const { markNotificationsReadHandler } = await import('./notifications.effects')
    return markNotificationsReadHandler(data)
  })

export function notificationsQueryKey(
  workspaceSlug: string
): readonly ['notifications', string] {
  return ['notifications', workspaceSlug]
}
