import { Auth } from '@b2b-saas-starter/auth'
import { type WorkspaceLifecycleBinding } from '@b2b-saas-starter/capabilities/governance/workspace-lifecycle'
import { Schema } from 'effect'
import { runAuth } from 'effectful-better-auth'
import { authRuntime } from '../auth-runtime'
import { currentRequest } from '../request-context'

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

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
class MissingRequestHeaders extends Schema.TaggedError<MissingRequestHeaders>()(
  'MissingRequestHeaders',
  { message: Schema.String }
) {}

function requireHeaders(headers: Headers | undefined): Headers {
  if (!headers) {
    // oxlint-disable-next-line effect/noThrowStatement -- rejects the promise the WorkspaceLifecycleBinding port returns; there is no Effect error channel on this side of it
    throw new MissingRequestHeaders({ message: 'no_request_headers' })
  }
  return headers
}

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
    const headers = requireHeaders(currentRequest()?.headers)
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
    const headers = requireHeaders(currentRequest()?.headers)
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
