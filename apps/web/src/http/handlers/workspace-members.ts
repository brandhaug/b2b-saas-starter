import {
  loadWorkspaceMembersHandler,
  changeMemberRoleHandler,
  removeMemberHandler,
  leaveWorkspaceHandler
} from '../../lib/server/workspace-members.effects'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../lib/server/workspace-members'
import { invoke } from '../errors'

export const handlers = HttpApiBuilder.group(Api, 'calls', (group) =>
  group
    .handle('loadWorkspaceMembersServerFn', ({ payload }) =>
      invoke(() => loadWorkspaceMembersHandler(payload))
    )
    .handle('changeMemberRoleServerFn', ({ payload }) =>
      invoke(() => changeMemberRoleHandler(payload))
    )
    .handle('removeMemberServerFn', ({ payload }) =>
      invoke(() => removeMemberHandler(payload))
    )
    .handle('leaveWorkspaceServerFn', ({ payload }) =>
      invoke(() => leaveWorkspaceHandler(payload))
    )
)
export { Api }
