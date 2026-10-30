import {
  requestWorkspaceExportHandler,
  downloadWorkspaceExportHandler
} from '../../lib/server/workspace-exports.effects'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../lib/server/workspace-exports'
import { invoke } from '../errors'

export const handlers = HttpApiBuilder.group(Api, 'calls', (group) =>
  group
    .handle('requestWorkspaceExportServerFn', ({ payload }) =>
      invoke(() => requestWorkspaceExportHandler(payload))
    )
    .handle('downloadWorkspaceExportServerFn', ({ payload }) =>
      invoke(() => downloadWorkspaceExportHandler(payload))
    )
)
export { Api }
