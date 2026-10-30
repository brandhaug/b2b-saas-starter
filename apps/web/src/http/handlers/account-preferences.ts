import { setLocalePreferencesHandler } from '../../lib/server/account-preferences.effects'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../lib/server/account-preferences'
import { invoke } from '../errors'

export const handlers = HttpApiBuilder.group(Api, 'calls', (group) =>
  group.handle('setLocalePreferencesServerFn', ({ payload }) =>
    invoke(() => setLocalePreferencesHandler(payload))
  )
)
export { Api }
