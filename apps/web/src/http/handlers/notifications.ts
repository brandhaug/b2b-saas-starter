import {
  listNotificationsHandler,
  markNotificationsReadHandler
} from '../../lib/server/notifications.effects'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../lib/server/notifications'
import { invoke } from '../errors'

export const handlers = HttpApiBuilder.group(Api, 'calls', (group) =>
  group
    .handle('listNotificationsServerFn', ({ payload }) =>
      invoke(() => listNotificationsHandler(payload))
    )
    .handle('markNotificationsReadServerFn', ({ payload }) =>
      invoke(() => markNotificationsReadHandler(payload))
    )
)
export { Api }
