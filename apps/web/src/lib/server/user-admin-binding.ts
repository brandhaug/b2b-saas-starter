import { Auth } from '@b2b-saas-starter/auth'
import { type PlatformUserAdminBinding } from '@b2b-saas-starter/capabilities/governance/platform-user-admin'
import { Schema } from 'effect'
import { runAuth } from 'effectful-better-auth'
import { authRuntime } from '../auth-runtime'
import { currentRequest } from '../request-context'

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
 * from. No `statusCode`, deliberately: the capability classifies it on the
 * unavailable side (the store is not refusing — there was no store to ask).
 */
// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
class MissingRequestHeaders extends Schema.TaggedError<MissingRequestHeaders>()(
  'MissingRequestHeaders',
  { message: Schema.String }
) {}

function requireHeaders(headers: Headers | undefined): Headers {
  if (!headers) {
    // oxlint-disable-next-line effect/noThrowStatement -- rejects the promise the PlatformUserAdminBinding port returns; there is no Effect error channel on this side of it
    throw new MissingRequestHeaders({ message: 'no_request_headers' })
  }
  return headers
}

export const webUserAdminBinding: PlatformUserAdminBinding = {
  banUser: async (input) => {
    const headers = requireHeaders(currentRequest()?.headers)
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
    const headers = requireHeaders(currentRequest()?.headers)
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
    const headers = requireHeaders(currentRequest()?.headers)
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
