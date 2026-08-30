import { Auth } from '@b2b-saas-starter/auth'
import { type PlatformUserAdminBinding } from '@b2b-saas-starter/capabilities/governance/platform-user-admin'
import { runAuth } from 'effectful-better-auth'
import { authRuntime } from '../auth-runtime'
import { requestHeaders } from './require-headers'

/**
 * The web app's adapter onto Better Auth's `admin` endpoints (plus the
 * organization plugin's member-role update) — the app half of the
 * `PlatformUserAdminBinding` port that `@b2b-saas-starter/capabilities`
 * declares.
 *
 * Server-only for the same reason `webMemberBinding` is: importing
 * `packages/auth` from a browser-bundled module would drag the whole Better
 * Auth server instance into the client bundle. Every endpoint behind this
 * port is `requireHeaders: true` — the plugin enforces the admin role from
 * the request's own session — so headers are read at call time and one
 * module-level adapter serves every request without capturing one.
 */

/**
 * A plugin call attempted with no in-flight request to take session headers
 * from fails as `MissingRequestHeaders` (see `./require-headers.ts`).
 */

export const webUserAdminBinding: PlatformUserAdminBinding = {
  banUser: async (input) => {
    const headers = requestHeaders()
    await runAuth({
      tag: Auth.Tag,
      runtime: authRuntime,
      headers,
      build: (api) =>
        api.banUser({
          body: { userId: input.userId },
          headers
        })
    })
  },
  unbanUser: async (input) => {
    const headers = requestHeaders()
    await runAuth({
      tag: Auth.Tag,
      runtime: authRuntime,
      headers,
      build: (api) =>
        api.unbanUser({
          body: { userId: input.userId },
          headers
        })
    })
  },
  setMemberRole: async (input) => {
    const headers = requestHeaders()
    await runAuth({
      tag: Auth.Tag,
      runtime: authRuntime,
      headers,
      build: (api) =>
        api.updateMemberRole({
          body: {
            role: input.role,
            memberId: input.memberId,
            organizationId: input.workspaceId
          },
          headers
        })
    })
  }
}
