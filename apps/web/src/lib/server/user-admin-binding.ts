import { type PlatformUserAdminBinding } from '@b2b-saas-starter/capabilities/governance/platform-user-admin'

import { sessionCall } from './plugin-call'

/**
 * The web app's adapter onto Better Auth's `admin` endpoints (plus the
 * organization plugin's member-role update) — the app half of the
 * `PlatformUserAdminBinding` port that `@b2b-saas-starter/capabilities`
 * declares. Every endpoint behind this port is `requireHeaders: true`: the
 * plugin enforces the admin role from the request's own session. See
 * `./plugin-call.ts`.
 */
export const webUserAdminBinding: PlatformUserAdminBinding = {
  banUser: async (input) => {
    await sessionCall((api, headers) =>
      api.banUser({ body: { userId: input.userId }, headers })
    )
  },
  unbanUser: async (input) => {
    await sessionCall((api, headers) =>
      api.unbanUser({ body: { userId: input.userId }, headers })
    )
  },
  setMemberRole: async (input) => {
    await sessionCall((api, headers) =>
      api.updateMemberRole({
        body: {
          role: input.role,
          memberId: input.memberId,
          organizationId: input.workspaceId
        },
        headers
      })
    )
  }
}
