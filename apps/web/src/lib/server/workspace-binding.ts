import { Auth } from '@b2b-saas-starter/auth'
import { type WorkspaceLifecycleBinding } from '@b2b-saas-starter/capabilities/governance/workspace-lifecycle'
import { runAuth } from 'effectful-better-auth'
import { authRuntime } from '../auth-runtime'
import { requestHeaders } from './require-headers'

/**
 * The web app's adapter onto Better Auth's `organization` lifecycle endpoints
 * (create, update, delete) — the app half of the `WorkspaceLifecycleBinding`
 * port that `@b2b-saas-starter/capabilities` declares.
 *
 * Same rules as `invitation-binding.ts`, which this file mirrors: server-only
 * module so `packages/auth` stays out of the client bundle; headers read at
 * call time; rejections thrown raw so the capability's classifier can read the
 * plugin error's `statusCode`.
 *
 * Only `create` runs headerless (the plugin accepts a `userId` body field);
 * rename and delete demand the session cookie.
 */

/**
 * A plugin call attempted with no in-flight request to take session headers
 * from fails as `MissingRequestHeaders` (see `./require-headers.ts`).
 */

export const webWorkspaceLifecycleBinding: WorkspaceLifecycleBinding = {
  // Create alone is headerless; the plugin takes the creator from the body.
  create: async (input) => {
    await runAuth({
      tag: Auth.Tag,
      runtime: authRuntime,
      build: (api) =>
        api.createOrganization({
          body: { name: input.name, slug: input.slug, userId: input.userId }
        })
    })
  },
  rename: async (input) => {
    const headers = requestHeaders()
    await runAuth({
      tag: Auth.Tag,
      runtime: authRuntime,
      headers,
      build: (api) =>
        api.updateOrganization({
          body: {
            data: { name: input.name },
            organizationId: input.workspaceId
          },
          headers
        })
    })
  },
  remove: async (input) => {
    const headers = requestHeaders()
    await runAuth({
      tag: Auth.Tag,
      runtime: authRuntime,
      headers,
      build: (api) =>
        api.deleteOrganization({
          body: { organizationId: input.workspaceId },
          headers
        })
    })
  }
}
