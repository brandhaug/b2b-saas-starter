import { Auth } from '@b2b-saas-starter/auth'
import { type WorkspaceMemberBinding } from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import { runAuth } from 'effectful-better-auth'
import { authRuntime } from '../auth-runtime'
import { requestHeaders } from './require-headers'

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

/**
 * A plugin call attempted with no in-flight request to take session headers
 * from fails as `MissingRequestHeaders` (see `./require-headers.ts`).
 */

export const webMemberBinding: WorkspaceMemberBinding = {
  // The plugin's add-member route is a trusted server-side call (`serverOnly`,
  // no session middleware), so it runs headerless by design.
  addMember: async (input) => {
    await runAuth({
      tag: Auth.Tag,
      runtime: authRuntime,
      build: (api) =>
        api.addMember({
          body: {
            userId: input.userId,
            role: input.role,
            organizationId: input.workspaceId
          }
        })
    })
  },
  removeMember: async (input) => {
    const headers = requestHeaders()
    await runAuth({
      tag: Auth.Tag,
      runtime: authRuntime,
      headers,
      build: (api) =>
        api.removeMember({
          body: {
            memberIdOrEmail: input.memberId,
            organizationId: input.workspaceId
          },
          headers
        })
    })
  },
  changeRole: async (input) => {
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
