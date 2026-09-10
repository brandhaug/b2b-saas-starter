import { type AccountLifecycleBinding } from '@b2b-saas-starter/capabilities/governance/account-lifecycle'
import { makeAdminAccountLifecycleBinding } from '@b2b-saas-starter/capabilities/governance/account-lifecycle-admin.live'
import { env } from 'cloudflare:workers'

import { webMemberBinding } from './member-binding'
import { sessionCall } from './plugin-call'
import { webWorkspaceLifecycleBinding } from './workspace-binding'

/**
 * The web app's adapter onto the three session-bound endpoints the account
 * lifecycle drives — the app half of the `AccountLifecycleBinding` port that
 * `@b2b-saas-starter/capabilities` declares. All three run under the
 * deleting user's own session: leave and delete reuse the organization
 * plugin adapters in `member-binding.ts` and `workspace-binding.ts`, and the
 * account delete goes through Better Auth's
 * core `/delete-user`, which verifies the password before any hook runs.
 * See `./plugin-call.ts`.
 */
export const webAccountLifecycleBinding: AccountLifecycleBinding = {
  // Both writes are the same plugin endpoints the membership and workspace
  // bindings already wrap, called under the deleting user's own session.
  // `input.memberId` is redundant here (the session is the member) but stays
  // on the port for the Seed adapter, which resolves by row id.
  leaveWorkspace: (input) => webMemberBinding.leave({ workspaceId: input.workspaceId }),
  deleteWorkspace: (input) =>
    webWorkspaceLifecycleBinding.remove({ workspaceId: input.workspaceId }),
  deleteUser: async (input) => {
    await sessionCall((api, headers) =>
      api.deleteUser({ body: { password: input.password }, headers })
    )
  }
}

/** The admin endpoint's authorized target-account teardown, owned by governance. */
export const webAdminAccountLifecycleBinding = makeAdminAccountLifecycleBinding(env.DB)
