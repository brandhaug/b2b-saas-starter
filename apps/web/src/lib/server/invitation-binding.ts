import { type WorkspaceInvitationBinding } from '@b2b-saas-starter/capabilities/governance/workspace-invitations'

import { sessionCall } from './plugin-call'

/**
 * The web app's adapter onto Better Auth's `organization` invitation endpoints
 * — the app half of the `WorkspaceInvitationBinding` port that
 * `@b2b-saas-starter/capabilities` declares. Every endpoint it wraps is
 * `requireHeaders: true`, so every call goes through `sessionCall` — see
 * `./plugin-call.ts` for why the adapters live server-only.
 */
export const webInvitationBinding: WorkspaceInvitationBinding = {
  create: async (input) => {
    await sessionCall((api, headers) =>
      api.createInvitation({
        body: {
          email: input.email,
          role: input.role,
          organizationId: input.workspaceId
        },
        headers
      })
    )
  },
  cancel: async (input) => {
    await sessionCall((api, headers) =>
      api.cancelInvitation({ body: { invitationId: input.invitationId }, headers })
    )
  },
  // The plugin reads the accepting user from this session and refuses an
  // invitation addressed to anyone else, which is why the port passes no user.
  accept: async (input) => {
    await sessionCall((api, headers) =>
      api.acceptInvitation({ body: { invitationId: input.invitationId }, headers })
    )
  }
}
