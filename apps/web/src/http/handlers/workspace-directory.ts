import { loadWorkspaceDirectoryHandler } from '../../lib/server/workspace-directory.effects'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../lib/server/workspace-directory'
import { invoke } from '../errors'

export const handlers = HttpApiBuilder.group(Api, 'calls', (group) =>
  group.handle('loadWorkspaceDirectoryServerFn', () =>
    invoke(() => loadWorkspaceDirectoryHandler())
  )
)
export { Api }
