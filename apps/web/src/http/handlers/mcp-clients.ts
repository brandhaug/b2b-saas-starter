import {
  loadMcpClientConnectionsHandler,
  revokeMcpClientHandler
} from '../../lib/server/mcp-clients.effects'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../lib/server/mcp-clients'
import { invoke } from '../errors'

export const handlers = HttpApiBuilder.group(Api, 'calls', (group) =>
  group
    .handle('loadMcpClientConnectionsServerFn', () =>
      invoke(() => loadMcpClientConnectionsHandler())
    )
    .handle('revokeMcpClientServerFn', ({ payload }) =>
      invoke(() => revokeMcpClientHandler(payload))
    )
)
export { Api }
