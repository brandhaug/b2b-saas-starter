import { Effect, Result, Schema } from 'effect'
import { Auth, type AuthOptions } from '@b2b-saas-starter/auth'
import { type WorkspaceLifecycleBinding } from '@b2b-saas-starter/capabilities'
import { type Service } from 'effectful-better-auth'
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
 * rename and delete demand the session cookie, which is why they go through
 * `runBinding` like every invitation endpoint does.
 */

type AuthService = Service<AuthOptions>

class MissingRequestHeaders extends Schema.TaggedErrorClass<MissingRequestHeaders>()(
  'MissingRequestHeaders',
  { message: Schema.String }
) {}

async function runBinding<A>(
  build: (auth: AuthService, headers?: Headers) => Effect.Effect<A, unknown, never>
): Promise<void> {
  const request = currentRequest()
  const headers = request?.headers
  const result = await authRuntime.runPromise(
    Effect.result(Effect.flatMap(Auth.Tag, (auth) => build(auth, headers)))
  )
  if (Result.isFailure(result)) {
    // oxlint-disable-next-line effect/noThrowStatement -- the capability classifies this value by its statusCode, so it must arrive as the rejection
    throw result.failure
  }
}

function requireHeaders(headers: Headers | undefined): Headers {
  if (!headers) {
    // oxlint-disable-next-line effect/noThrowStatement -- rejects the promise the WorkspaceLifecycleBinding port returns; there is no Effect error channel on this side of it
    throw new MissingRequestHeaders({ message: 'no_request_headers' })
  }
  return headers
}

export const webWorkspaceLifecycleBinding: WorkspaceLifecycleBinding = {
  create: (input) =>
    runBinding((auth, headers) => {
      const options = { body: { name: input.name, slug: input.slug, userId: input.userId } }
      // Create alone is headerless; the plugin takes the creator from the body.
      if (headers) {
        return auth.api.createOrganization({ ...options, headers })
      }
      return auth.api.createOrganization(options)
    }),
  rename: (input) =>
    runBinding((auth, headers) =>
      auth.api.updateOrganization({
        body: {
          data: { name: input.name },
          organizationId: input.workspaceId
        },
        headers: requireHeaders(headers)
      })
    ),
  remove: (input) =>
    runBinding((auth, headers) =>
      auth.api.deleteOrganization({
        body: { organizationId: input.workspaceId },
        headers: requireHeaders(headers)
      })
    )
}
