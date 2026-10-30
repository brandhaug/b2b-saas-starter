import { MissingD1Binding } from './auth-local-d1'
import { Auth, type AuthOptions } from '@b2b-saas-starter/auth'
import {
  CurrentHeaders,
  MissingRequestHeaders,
  runAuth,
  type Api,
  type ApiFull
} from 'effectful-better-auth'
import { Effect } from 'effect'

import { authAvailability } from '../auth-runtime'
import { currentRequest } from '../request-context'
import { withAuthCookies, type AuthResponse } from './auth-response'

/**
 * The two ways the server-only `*-binding.ts` adapters (invitation, member,
 * user-admin, workspace lifecycle) reach a Better Auth plugin endpoint — the
 * app half of the binding ports `@b2b-saas-starter/capabilities` declares.
 *
 * They live here, in a server-only module, rather than beside `starterEnv` in
 * browser contracts must never import the Better Auth server instance.
 * Application handlers pass an adapter in per call instead.
 *
 * Rejections are left raw so the capability's classifier can read the plugin
 * error's `statusCode` (see `plugin-binding-failure.ts` in the capabilities
 * package) — nothing here maps a failure.
 */

/** The effectful `api` surface of the app's own Better Auth instance. */
type AuthApi = Api<AuthOptions>

/**
 * A plugin endpoint that is `requireHeaders: true`: the plugin decides from
 * the request's own session (who is inviting, who may change a role, who holds
 * the admin role), so the session cookie is not optional — it is the whole
 * reason these adapters have to exist in the app at all. Headers are read at
 * call time, so one module-level adapter serves every request without
 * capturing one. The library carries them as ambient `CurrentHeaders`, so
 * `full.*` calls inside `build` may omit `headers`; the raw `Headers` are still
 * handed to `build` for the callers that forward them elsewhere (the MCP
 * consent re-entry builds a request carrier from them). A call with no
 * in-flight request rejects with the library's `MissingRequestHeaders`, which
 * classifies as unavailable, never as a refusal — and rejects before the
 * runtime is touched, so a no-request caller never boots the auth instance.
 */
export function sessionCall<A, E>(
  build: (
    api: ApiFull<AuthOptions>,
    headers: Headers
  ) => Effect.Effect<AuthResponse<A>, E>
): Promise<A> {
  const headers = currentRequest()?.headers
  if (headers === undefined) {
    return Effect.runPromise(Effect.fail(new MissingRequestHeaders()))
  }
  const auth = authAvailability()
  if (!auth.available) {
    return Effect.runPromise(Effect.fail(new MissingD1Binding({ property: 'DB' })))
  }
  return auth.runtime.runPromise(
    Effect.flatMap(Auth.Tag, ({ full }) => withAuthCookies(build(full, headers))).pipe(
      Effect.provideService(CurrentHeaders, headers)
    )
  )
}

/**
 * A plugin endpoint that runs trusted and headerless by design: the plugin's
 * add-member and create-organization routes take the acting user from the body
 * (`serverOnly`, no session middleware), so there is no session to forward and
 * no request to require.
 */
export function serverCall<A, E>(
  build: (api: AuthApi) => Effect.Effect<A, E>
): Promise<A> {
  const auth = authAvailability()
  if (!auth.available) {
    return Effect.runPromise(Effect.fail(new MissingD1Binding({ property: 'DB' })))
  }
  return runAuth({ tag: Auth.Tag, runtime: auth.runtime, build })
}
