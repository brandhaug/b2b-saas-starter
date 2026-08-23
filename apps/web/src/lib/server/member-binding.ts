import { Auth, type AuthOptions } from '@b2b-saas-starter/auth'
import { type WorkspaceMemberBinding } from '@b2b-saas-starter/capabilities/src/governance/workspace-membership.ts'
import { Effect, Result, Schema } from 'effect'
import { type Service } from 'effectful-better-auth'
import { authRuntime } from '../auth-runtime'
import { currentRequest } from '../request-context'

/**
 * The web app's adapter onto Better Auth's `organization` member endpoints —
 * the app half of the `WorkspaceMemberBinding` port that
 * `@b2b-saas-starter/capabilities` declares.
 *
 * It lives here, in a server-only module, rather than beside `starterEnv` in
 * `../capabilities.ts`: that module is bundled for the browser too (client-side
 * navigations re-run loaders against the Seed layer), and importing
 * `packages/auth` there would drag the whole Better Auth server instance into
 * the client bundle. Server functions pass this adapter in per call instead.
 *
 * `updateMemberRole` and `removeMember` are `requireHeaders: true`, so the
 * request's session cookie is not optional there — it is the whole reason this
 * adapter has to exist in the app at all (ADR 0051 keeps membership writes out
 * of the API worker for the same reason). The headers are read at call time, so
 * one module-level adapter serves every request without capturing one.
 */

type AuthService = Service<AuthOptions>

/**
 * A plugin call attempted with no in-flight request to take session headers
 * from. It carries an explicit `message` and, deliberately, no `statusCode`:
 * `classifyBindingFailure` reads the status to tell "the workspace refuses"
 * from "the store is unreachable", and nothing about the membership is wrong
 * here — so it must land on the unavailable side.
 */
class MissingRequestHeaders extends Schema.TaggedErrorClass<MissingRequestHeaders>()(
  'MissingRequestHeaders',
  { message: Schema.String }
) {}

/**
 * Rejects with the underlying failure itself rather than a wrapped cause, so
 * `classifyBindingFailure` in the capability can read its `statusCode`. Getting
 * this wrong turns every "the workspace refuses" into a 503 telling the caller
 * to retry something that can never succeed.
 *
 * `async` + `throw` rather than `Promise.reject`: this function *is* the promise
 * boundary the port asks for, and throwing inside an async function is how it
 * rejects without reaching for a Promise constructor.
 */
async function runBinding<A>(
  build: (
    auth: AuthService,
    headers: Headers | undefined
  ) => Effect.Effect<A, unknown, never>
): Promise<void> {
  const request = currentRequest()
  const result = await authRuntime.runPromise(
    Effect.result(Effect.flatMap(Auth.Tag, (auth) => build(auth, request?.headers)))
  )
  if (Result.isFailure(result)) {
    // oxlint-disable-next-line effect/noThrowStatement -- same boundary: the capability classifies this value by its statusCode, so it must arrive as the rejection
    throw result.failure
  }
}

function requireHeaders(headers: Headers | undefined): Headers {
  // oxlint-disable-next-line effect/noThrowStatement -- rejects the promise the WorkspaceMemberBinding port returns; there is no Effect error channel on this side of it
  if (!headers) throw new MissingRequestHeaders({ message: 'no_request_headers' })
  return headers
}

export const webMemberBinding: WorkspaceMemberBinding = {
  // The plugin's add-member route is a trusted server-side call (`serverOnly`,
  // no session middleware), so it runs headerless by design.
  addMember: (input) =>
    runBinding((auth) =>
      auth.api.addMember({
        body: {
          userId: input.userId,
          role: input.role,
          organizationId: input.workspaceId
        }
      })
    ),
  removeMember: (input) =>
    runBinding((auth, headers) =>
      auth.api.removeMember({
        body: {
          memberIdOrEmail: input.memberId,
          organizationId: input.workspaceId
        },
        headers: requireHeaders(headers)
      })
    ),
  changeRole: (input) =>
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
