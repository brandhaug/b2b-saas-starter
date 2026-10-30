import { loadWorkspaceAuditEventsHandler } from '../../lib/server/workspace-audit.effects'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../lib/server/workspace-audit'
import { invoke } from '../errors'

export const handlers = HttpApiBuilder.group(Api, 'calls', (group) =>
  group.handle('loadWorkspaceAuditEventsServerFn', ({ payload }) =>
    invoke(() => loadWorkspaceAuditEventsHandler(payload))
  )
)
export { Api }
