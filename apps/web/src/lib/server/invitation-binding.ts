import { Auth } from '@b2b-saas-starter/auth'
import { type WorkspaceInvitationBinding } from '@b2b-saas-starter/capabilities/governance/workspace-invitations'
import { runAuth } from 'effectful-better-auth'
import { authRuntime } from '../auth-runtime'
import { requestHeaders } from './require-headers'

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
 * from fails as `MissingRequestHeaders` (see `./require-headers.ts`).
 */

export const webInvitationBinding: WorkspaceInvitationBinding = {
  create: async (input) => {
    const headers = requestHeaders()
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
    const headers = requestHeaders()
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
    const headers = requestHeaders()
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
