import {
  loadOAuthConsentHandler,
  grantOAuthConsentHandler,
  denyOAuthConsentHandler
} from '../../lib/server/mcp-consent.effects'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../lib/server/mcp-consent'
import { invoke } from '../errors'

export const handlers = HttpApiBuilder.group(Api, 'calls', (group) =>
  group
    .handle('loadOAuthConsentServerFn', ({ payload }) =>
      invoke(() => loadOAuthConsentHandler(payload))
    )
    .handle('grantOAuthConsentServerFn', ({ payload }) =>
      invoke(() => grantOAuthConsentHandler(payload))
    )
    .handle('denyOAuthConsentServerFn', ({ payload }) =>
      invoke(() => denyOAuthConsentHandler(payload))
    )
)
export { Api }
