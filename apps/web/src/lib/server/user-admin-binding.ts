import { Auth, type AuthOptions } from '@b2b-saas-starter/auth'
import { type PlatformUserAdminBinding } from '@b2b-saas-starter/capabilities/src/governance/platform-user-admin.ts'
import { Effect, Result, Schema } from 'effect'
import { type Service } from 'effectful-better-auth'
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

type AuthService = Service<AuthOptions>

/**
 * A plugin call attempted with no in-flight request to take session headers
 * from. No `statusCode`, deliberately: the capability classifies it on the
 * unavailable side (the store is not refusing — there was no store to ask).
 */
class MissingRequestHeaders extends Schema.TaggedErrorClass<MissingRequestHeaders>()(
  'MissingRequestHeaders',
  { message: Schema.String }
) {}

function requireHeaders(headers: Headers | undefined): Headers {
  // oxlint-disable-next-line effect/noThrowStatement -- rejects the promise the PlatformUserAdminBinding port returns; there is no Effect error channel on this side of it
  if (!headers) throw new MissingRequestHeaders({ message: 'no_request_headers' })
  return headers
}

/**
 * Rejects with the underlying failure itself rather than a wrapped cause, so
 * `classifyBindingFailure` in the capability can read its `statusCode`.
 */
async function runBinding(
  build: (
    auth: AuthService,
    headers: Headers | undefined
  ) => Effect.Effect<unknown, unknown, never>
): Promise<void> {
  const request = currentRequest()
  const result = await authRuntime.runPromise(
    Effect.result(Effect.flatMap(Auth.Tag, (auth) => build(auth, request?.headers)))
  )
  if (Result.isFailure(result)) {
    // oxlint-disable-next-line effect/noThrowStatement -- same boundary as webMemberBinding: the capability classifies this value by its statusCode
    throw result.failure
  }
}

export const webUserAdminBinding: PlatformUserAdminBinding = {
  banUser: (input) =>
    runBinding((auth, headers) =>
      auth.api.banUser({
        body: { userId: input.userId },
        headers: requireHeaders(headers)
      })
    ),
  unbanUser: (input) =>
    runBinding((auth, headers) =>
      auth.api.unbanUser({
        body: { userId: input.userId },
        headers: requireHeaders(headers)
      })
    ),
  setMemberRole: (input) =>
    runBinding((auth, headers) =>
      auth.api.updateMemberRole({
        body: {
          role: input.role,
          memberId: input.memberId,
          organizationId: input.workspaceId
        },
        headers: requireHeaders(headers)
      })
    )
}
