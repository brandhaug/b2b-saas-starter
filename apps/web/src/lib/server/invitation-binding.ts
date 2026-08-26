import { Auth } from '@b2b-saas-starter/auth'
import { type WorkspaceInvitationBinding } from '@b2b-saas-starter/capabilities/governance/workspace-invitations'
import { Schema } from 'effect'
import { runAuth } from 'effectful-better-auth'
import { authRuntime } from '../auth-runtime'
import { currentRequest } from '../request-context'

/**
 * The web app's adapter onto Better Auth's `organization` invitation endpoints
 * — the app half of the `WorkspaceInvitationBinding` port that
 * `@b2b-saas-starter/capabilities` declares.
 *
 * It lives here, in a server-only module, rather than beside `starterEnv` in
 * `../capabilities.ts`: that module is bundled for the browser too (client-side
 * navigations re-run loaders against the Seed layer), and importing
 * `packages/auth` there would drag the whole Better Auth server instance into
 * the client bundle. Server functions pass this adapter in per call instead.
 *
 * Every invitation endpoint the plugin exposes is `requireHeaders: true`, so the
 * request's session cookie is not optional here — it is the only reason this
 * adapter has to exist in the app at all. The headers are read at call time, so
 * one module-level adapter serves every request without capturing one.
 */

/**
 * A plugin call attempted with no in-flight request to take session headers
 * from. It carries an explicit `message` and, deliberately, no `statusCode`:
 * `classifyBindingFailure` reads the status to tell "the workspace refuses"
 * from "the store is unreachable", and nothing about the invitation is wrong
 * here — so it must land on the unavailable side.
 */
// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
class MissingRequestHeaders extends Schema.TaggedError<MissingRequestHeaders>()(
  'MissingRequestHeaders',
  { message: Schema.String }
) {}

function requireHeaders(headers: Headers | undefined): Headers {
  // oxlint-disable-next-line effect/noThrowStatement -- rejects the promise the WorkspaceInvitationBinding port returns; there is no Effect error channel on this side of it
  if (!headers) throw new MissingRequestHeaders({ message: 'no_request_headers' })
  return headers
}

export const webInvitationBinding: WorkspaceInvitationBinding = {
  create: async (input) => {
    const headers = requireHeaders(currentRequest()?.headers)
    await runAuth({
      tag: Auth.Tag,
      runtime: authRuntime,
      headers,
      build: (api) =>
        api.createInvitation({
          body: {
            email: input.email,
            role: input.role,
            organizationId: input.workspaceId
          },
          headers
        })
    })
  },
  cancel: async (input) => {
    const headers = requireHeaders(currentRequest()?.headers)
    await runAuth({
      tag: Auth.Tag,
      runtime: authRuntime,
      headers,
      build: (api) =>
        api.cancelInvitation({
          body: { invitationId: input.invitationId },
          headers
        })
    })
  },
  // The plugin reads the accepting user from this session and refuses an
  // invitation addressed to anyone else, which is why the port passes no user.
  accept: async (input) => {
    const headers = requireHeaders(currentRequest()?.headers)
    await runAuth({
      tag: Auth.Tag,
      runtime: authRuntime,
      headers,
      build: (api) =>
        api.acceptInvitation({
          body: { invitationId: input.invitationId },
          headers
        })
    })
  }
}
