import {
  createWorkspaceHandler,
  renameWorkspaceHandler,
  deleteWorkspaceHandler
} from '../../lib/server/workspace-lifecycle.effects'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../lib/server/workspace-lifecycle'
import { invoke } from '../errors'

export const handlers = HttpApiBuilder.group(Api, 'calls', (group) =>
  group
    .handle('createWorkspaceServerFn', ({ payload }) =>
      invoke(() => createWorkspaceHandler(payload))
    )
    .handle('renameWorkspaceServerFn', ({ payload }) =>
      invoke(() => renameWorkspaceHandler(payload))
    )
    .handle('deleteWorkspaceServerFn', ({ payload }) =>
      invoke(() => deleteWorkspaceHandler(payload))
    )
)
export { Api }
