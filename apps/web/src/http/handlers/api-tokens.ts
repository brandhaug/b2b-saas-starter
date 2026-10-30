import {
  loadWorkspaceApiTokensHandler,
  createApiTokenHandler,
  revokeApiTokenHandler,
  replaceApiTokenHandler
} from '../../lib/server/api-tokens.effects'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../lib/server/api-tokens'
import { invoke } from '../errors'

export const handlers = HttpApiBuilder.group(Api, 'calls', (group) =>
  group
    .handle('loadWorkspaceApiTokensServerFn', ({ payload }) =>
      invoke(() => loadWorkspaceApiTokensHandler(payload))
    )
    .handle('createApiTokenServerFn', ({ payload }) =>
      invoke(() => createApiTokenHandler(payload))
    )
    .handle('revokeApiTokenServerFn', ({ payload }) =>
      invoke(() => revokeApiTokenHandler(payload))
    )
    .handle('replaceApiTokenServerFn', ({ payload }) =>
      invoke(() => replaceApiTokenHandler(payload))
    )
)
export { Api }
