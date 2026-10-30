import {
  loadNotificationPreferencesHandler,
  setNotificationPreferenceHandler
} from '../../lib/server/notification-preferences.effects'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../lib/server/notification-preferences'
import { invoke } from '../errors'

export const handlers = HttpApiBuilder.group(Api, 'calls', (group) =>
  group
    .handle('loadNotificationPreferencesServerFn', () =>
      invoke(() => loadNotificationPreferencesHandler())
    )
    .handle('setNotificationPreferenceServerFn', ({ payload }) =>
      invoke(() => setNotificationPreferenceHandler(payload))
    )
)
export { Api }
