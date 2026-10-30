import {
  createSsoConnectionHandler,
  updateSsoConnectionHandler,
  removeSsoConnectionHandler,
  testSsoConnectionHandler,
  resolveSsoRoutingHandler
} from '../../lib/server/workspace-sso.effects'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../lib/server/workspace-sso'
import { invoke } from '../errors'

export const handlers = HttpApiBuilder.group(Api, 'calls', (group) =>
  group
    .handle('createSsoConnectionServerFn', ({ payload }) =>
      invoke(() => createSsoConnectionHandler(payload))
    )
    .handle('updateSsoConnectionServerFn', ({ payload }) =>
      invoke(() => updateSsoConnectionHandler(payload))
    )
    .handle('removeSsoConnectionServerFn', ({ payload }) =>
      invoke(() => removeSsoConnectionHandler(payload))
    )
    .handle('testSsoConnectionServerFn', ({ payload }) =>
      invoke(() => testSsoConnectionHandler(payload))
    )
    .handle('resolveSsoRoutingServerFn', ({ payload }) =>
      invoke(() => resolveSsoRoutingHandler(payload))
    )
)
export { Api }
