import { type WorkspaceLifecycleBinding } from '@b2b-saas-starter/capabilities/governance/workspace-lifecycle'

import { serverCall, sessionCall } from './plugin-call'

/**
 * The web app's adapter onto Better Auth's `organization` lifecycle endpoints
 * (create, update, delete) — the app half of the `WorkspaceLifecycleBinding`
 * port that `@b2b-saas-starter/capabilities` declares. Only `create` runs
 * headerless (the plugin takes the creator from the body); rename and delete
 * demand the session cookie. See `./plugin-call.ts`.
 */
export const webWorkspaceLifecycleBinding: WorkspaceLifecycleBinding = {
  create: async (input) => {
    await serverCall((api) =>
      api.createOrganization({
        body: { name: input.name, slug: input.slug, userId: input.userId }
      })
    )
  },
  rename: async (input) => {
    await sessionCall((api, headers) =>
      api.updateOrganization({
        body: {
          data: { name: input.name },
          organizationId: input.workspaceId
        },
        headers
      })
    )
  },
  remove: async (input) => {
    await sessionCall((api, headers) =>
      api.deleteOrganization({
        body: { organizationId: input.workspaceId },
        headers
      })
    )
  }
}
