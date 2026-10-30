import { readSocialProviderIdsHandler } from '../../lib/server/social-providers.effects'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../lib/server/social-providers'
import { invoke } from '../errors'

export const handlers = HttpApiBuilder.group(Api, 'calls', (group) =>
  group.handle('getSocialProviderIds', () =>
    invoke(() => readSocialProviderIdsHandler())
  )
)
export { Api }
