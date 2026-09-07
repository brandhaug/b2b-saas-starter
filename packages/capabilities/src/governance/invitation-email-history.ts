import { EmailDelivery } from '@b2b-saas-starter/email-delivery/email-delivery'
import { Effect } from 'effect'
import { WorkspaceContext } from '../workspace-context.ts'

/** Read invitation delivery evidence after the workspace context is resolved. */
export const listInvitationEmailHistory = Effect.fn('InvitationEmailHistory.list')(
  function* () {
    const context = yield* WorkspaceContext
    const delivery = yield* EmailDelivery
    return yield* delivery.listInvitations(context.workspace.id)
  }
)

/** Read the latest delivery evidence for an invitation in the current workspace. */
export const latestInvitationEmailHistory = Effect.fn('InvitationEmailHistory.latest')(
  function* (referenceId: string) {
    const context = yield* WorkspaceContext
    const delivery = yield* EmailDelivery
    return yield* delivery.latestInvitation(context.workspace.id, referenceId)
  }
)
