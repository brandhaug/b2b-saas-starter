import { loadWorkspaceDashboardHandler } from '../../lib/server/workspace-dashboard.effects'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../lib/server/workspace-dashboard'
import { invoke } from '../errors'

export const handlers = HttpApiBuilder.group(Api, 'calls', (group) =>
  group.handle('loadWorkspaceDashboardServerFn', ({ payload }) =>
    invoke(() => loadWorkspaceDashboardHandler(payload))
  )
)
export { Api }
