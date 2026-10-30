import {
  loadWorkspaceSuspensionHandler,
  loadWorkspaceRecoveryHandler
} from '../../lib/server/workspace-suspension.effects'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../lib/server/workspace-suspension'
import { invoke } from '../errors'

export const handlers = HttpApiBuilder.group(Api, 'calls', (group) =>
  group
    .handle('loadWorkspaceSuspensionServerFn', ({ payload }) =>
      invoke(() => loadWorkspaceSuspensionHandler(payload))
    )
    .handle('loadWorkspaceRecoveryServerFn', ({ payload }) =>
      invoke(() => loadWorkspaceRecoveryHandler(payload))
    )
)
export { Api }
