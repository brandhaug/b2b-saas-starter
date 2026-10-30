import {
  listAdminWorkspacesHandler,
  transitionAdminWorkspaceHandler,
  listSystemUsersHandler,
  loadAdminAuditEventsHandler,
  banSystemUserHandler,
  unbanSystemUserHandler,
  listUserWorkspacesHandler,
  changeUserWorkspaceRoleHandler,
  impersonateUserHandler,
  stopImpersonatingHandler,
  loadFailedDeliveriesHandler,
  replayFailedDeliveryHandler
} from '../../lib/server/admin.effects'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../lib/server/admin'
import { invoke } from '../errors'

export const handlers = HttpApiBuilder.group(Api, 'calls', (group) =>
  group
    .handle('listAdminWorkspacesServerFn', () =>
      invoke(() => listAdminWorkspacesHandler())
    )
    .handle('transitionAdminWorkspaceServerFn', ({ payload }) =>
      invoke(() => transitionAdminWorkspaceHandler(payload))
    )
    .handle('listSystemUsersServerFn', () => invoke(() => listSystemUsersHandler()))
    .handle('loadAdminAuditEventsServerFn', () =>
      invoke(() => loadAdminAuditEventsHandler())
    )
    .handle('banSystemUserServerFn', ({ payload }) =>
      invoke(() => banSystemUserHandler(payload))
    )
    .handle('unbanSystemUserServerFn', ({ payload }) =>
      invoke(() => unbanSystemUserHandler(payload))
    )
    .handle('listUserWorkspacesServerFn', ({ payload }) =>
      invoke(() => listUserWorkspacesHandler(payload))
    )
    .handle('changeUserWorkspaceRoleServerFn', ({ payload }) =>
      invoke(() => changeUserWorkspaceRoleHandler(payload))
    )
    .handle('impersonateUserServerFn', ({ payload }) =>
      invoke(() => impersonateUserHandler(payload))
    )
    .handle('stopImpersonatingServerFn', () => invoke(() => stopImpersonatingHandler()))
    .handle('loadFailedDeliveriesServerFn', ({ payload }) =>
      invoke(() => loadFailedDeliveriesHandler(payload))
    )
    .handle('replayFailedDeliveryServerFn', ({ payload }) =>
      invoke(() => replayFailedDeliveryHandler(payload))
    )
)
export { Api }
