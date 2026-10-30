import {
  sendInvitationHandler,
  cancelInvitationHandler,
  resendInvitationHandler,
  invitationPreviewHandler,
  acceptInvitationHandler
} from '../../lib/server/invitations.effects'
import { HttpApiBuilder } from 'effect/http-api'
import { Api } from '../../lib/server/invitations'
import { invoke } from '../errors'

export const handlers = HttpApiBuilder.group(Api, 'calls', (group) =>
  group
    .handle('sendInvitationServerFn', ({ payload }) =>
      invoke(() => sendInvitationHandler(payload))
    )
    .handle('cancelInvitationServerFn', ({ payload }) =>
      invoke(() => cancelInvitationHandler(payload))
    )
    .handle('resendInvitationServerFn', ({ payload }) =>
      invoke(() => resendInvitationHandler(payload))
    )
    .handle('invitationPreviewServerFn', ({ payload }) =>
      invoke(() => invitationPreviewHandler(payload))
    )
    .handle('acceptInvitationServerFn', ({ payload }) =>
      invoke(() => acceptInvitationHandler(payload))
    )
)
export { Api }
