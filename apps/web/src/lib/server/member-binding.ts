import { type WorkspaceMemberBinding } from '@b2b-saas-starter/capabilities/governance/workspace-membership'

import { serverCall, sessionCall } from './plugin-call'

/**
 * The web app's adapter onto Better Auth's `organization` member endpoints —
 * the app half of the `WorkspaceMemberBinding` port that
 * `@b2b-saas-starter/capabilities` declares. `updateMemberRole`,
 * `removeMember`, and `leave` are `requireHeaders: true` (ADR 0051 keeps
 * membership writes out of the API worker for that reason); the add-member
 * route is trusted and headerless. See `./plugin-call.ts`.
 */
export const webMemberBinding: WorkspaceMemberBinding = {
  addMember: async (input) => {
    await serverCall((api) =>
      api.addMember({
        body: {
          userId: input.userId,
          role: input.role,
          organizationId: input.workspaceId
        }
      })
    )
  },
  removeMember: async (input) => {
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
  // The plugin's leave endpoint resolves the member from the session, so the
  // workspace id is the whole body — unlike `removeMember`, no `member:delete`
  // permission applies, which is what makes leaving a plain member's right.
  leave: async (input) => {
    await sessionCall((api, headers) =>
      api.leaveOrganization({
        body: { organizationId: input.workspaceId },
        headers
      })
    )
  },
  changeRole: async (input) => {
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
