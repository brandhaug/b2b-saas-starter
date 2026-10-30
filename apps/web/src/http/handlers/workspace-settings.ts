import { loadWorkspaceSettingsHandler } from '../../lib/server/workspace-settings.effects'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../lib/server/workspace-settings'
import { invoke } from '../errors'

export const handlers = HttpApiBuilder.group(Api, 'calls', (group) =>
  group.handle('loadWorkspaceSettingsServerFn', ({ payload }) =>
    invoke(() => loadWorkspaceSettingsHandler(payload))
  )
)
export { Api }
