import { type AccountLifecycleBinding } from '@b2b-saas-starter/capabilities/governance/account-lifecycle'

import { sessionCall } from './plugin-call'

/**
 * The web app's adapter onto the three session-bound endpoints the account
 * lifecycle drives — the app half of the `AccountLifecycleBinding` port that
 * `@b2b-saas-starter/capabilities` declares. All three run under the
 * deleting user's own session: leave and delete through the organization
 * plugin's endpoints (the same ones `member-binding.ts` and
 * `workspace-binding.ts` wrap), and the account delete through Better Auth's
 * core `/delete-user`, which verifies the password before any hook runs.
 * See `./plugin-call.ts`.
 */
export const webAccountLifecycleBinding: AccountLifecycleBinding = {
  leaveWorkspace: async (input) => {
    await sessionCall((api, headers) =>
      api.removeMember({
        body: {
          memberIdOrEmail: input.memberId,
          organizationId: input.workspaceId
        },
        headers
      })
    )
  },
  deleteWorkspace: async (input) => {
    await sessionCall((api, headers) =>
      api.deleteOrganization({
        body: { organizationId: input.workspaceId },
        headers
      })
    )
  },
  deleteUser: async (input) => {
    await sessionCall((api, headers) =>
      api.deleteUser({ body: { password: input.password }, headers })
    )
  }
}
