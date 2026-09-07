import { type AccountLifecycleBinding } from '@b2b-saas-starter/capabilities/governance/account-lifecycle'
import * as schema from '@b2b-saas-starter/db/schema'
import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { and, eq } from 'drizzle-orm'

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
  // The plugin's leave endpoint resolves the member from the deleting user's
  // session — unlike `removeMember`, no `member:delete` permission applies,
  // so a plain member can leave their workspaces as part of deleting the
  // account. `input.memberId` is redundant here (the session is the member)
  // but stays on the port for the Seed adapter, which resolves by row id.
  leaveWorkspace: async (input) => {
    void input.memberId
    await sessionCall((api, headers) =>
      api.leaveOrganization({
        body: { organizationId: input.workspaceId },
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

/**
 * The admin remove-user endpoint has an admin session, not the target user's
 * session. Its lifecycle hook therefore cannot use the session-bound
 * organization endpoints above without mutating the wrong account. The admin
 * endpoint is already Better Auth's privileged, role-checked surface, so its
 * teardown uses the same D1 rows directly and leaves the capability in charge
 * of the ownership rule and audit records.
 */
export const webAdminAccountLifecycleBinding: AccountLifecycleBinding = {
  leaveWorkspace: async (input) => {
    const db = adminDeletionDatabase()
    await db
      .delete(schema.workspaceMembers)
      .where(
        and(
          eq(schema.workspaceMembers.id, input.memberId),
          eq(schema.workspaceMembers.workspaceId, input.workspaceId)
        )
      )
  },
  deleteWorkspace: async (input) => {
    const db = adminDeletionDatabase()
    await db
      .delete(schema.workspaces)
      .where(eq(schema.workspaces.id, input.workspaceId))
  },
  deleteUser: () => {
    // The admin endpoint owns the user-row delete. This binding only supplies
    // the pre-delete workspace teardown, so reaching this method is a wiring
    // error rather than a second deletion path.
    // oxlint-disable-next-line effect/noNewPromise, effect/noNewError -- this promise-shaped binding is an impossible wiring path; the Better Auth admin endpoint owns the row delete.
    return Promise.reject(new Error('admin account binding cannot delete the user row'))
  }
}

function adminDeletionDatabase() {
  if (env.DB === undefined) {
    // oxlint-disable-next-line effect/noThrowStatement, effect/noNewError -- a deployed admin deletion cannot proceed without its required D1 binding.
    throw new Error('admin account deletion requires the D1 binding')
  }
  return drizzle(env.DB)
}
