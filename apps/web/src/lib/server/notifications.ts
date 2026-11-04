import { type Notification } from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'

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
