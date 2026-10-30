import { readSiteKeyHandler } from '../../lib/server/turnstile.effects'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../lib/server/turnstile'
import { invoke } from '../errors'

export const handlers = HttpApiBuilder.group(Api, 'calls', (group) =>
  group.handle('getTurnstileSiteKey', () => invoke(() => readSiteKeyHandler()))
)
export { Api }
