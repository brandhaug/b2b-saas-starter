import { Auth, type Session } from '@b2b-saas-starter/auth'
import { notFound, redirect } from '@tanstack/react-router'
import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { Effect } from 'effect'
import { authRuntime } from '../auth-runtime'
import { memoizePerRequest, withWebRequestScope } from '../observability'
import { currentRequest } from '../request-context'

/**
 * The session read every gate below is built on. `authRuntime` carries the
 * `Auth` service only, so the scope has to come from the request:
 * `withWebRequestScope` makes this a child span of the request span and folds
 * the gate's outcome into that request's one wide event. Without it the gate
 * that runs first on every gated route would be invisible.
 */
// One session read per request through `memoizePerRequest`: a route whose
// `beforeLoad` gate and a server function both read the session must not pay
// two DB round-trips for one document request. Slots live on the request's
// telemetry, so they survive Start re-wrapping the `Request` mid-flight —
// which the old module-local WeakMap did not.
const readSession = createServerOnlyFn((): Promise<Session | null> =>
  memoizePerRequest('auth.session', () =>
    authRuntime.runPromise(
      withWebRequestScope(
        { event: 'auth.session' },
        Effect.gen(function* () {
          const auth = yield* Auth.Tag
          const request = currentRequest()
          // No ambient request (unit tests, scripts) means no cookie jar to
          // read — that is an unauthenticated caller, not a crash.
          if (request === undefined) {
            yield* Effect.annotateLogsScoped({ authenticated: false })
            return null
          }
          const session = yield* auth.api.getSession({ headers: request.headers })
          // Whether the gate found a session is the useful fact. Never the token,
          // never the email.
          yield* Effect.annotateLogsScoped({ authenticated: session !== null })
          return session
        })
      )
    )
  )
)

const getSessionServerFn = createServerFn({ method: 'GET' }).handler(readSession)

/**
 * The session projection route context carries. `beforeLoad` results are
 * serialized into the client payload of every gated route, so this is
 * deliberately narrow: the user fields the UI and loaders read, and nothing
 * else — no session token, no IP address, no user agent, no expiry. The
 * current session token for `/account`'s sessions panel comes from
 * `authClient.useSession()` instead (client-side, never in the SSR payload).
 */
export type RouteSession = {
  readonly user: {
    readonly id: string
    readonly email: string
    readonly emailVerified: boolean
    readonly role: string
    readonly twoFactorEnabled: boolean
  }
}

/**
 * Strips a Better Auth session down to `RouteSession`. Exported so the
 * projection's shape is asserted by test rather than trusted.
 */
export function toRouteSession(session: Session): RouteSession {
  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      // The plugin schema marks these optional; the gate only ever reads
      // them as scalars, so normalize to definite values here.
      // The plugin schema marks some of these optional; normalize to
      // definite values here.
      emailVerified: session.user.emailVerified,
      role: session.user.role ?? '',
      twoFactorEnabled: session.user.twoFactorEnabled ?? false
    }
  }
}

/**
 * Route gate for `beforeLoad`. Redirects unauthenticated visitors to
 * `/sign-in` and returns the projected session so loaders can pass the actor
 * to `runWorkspaceCapabilities`.
 */
export async function requireSession(redirectTo: string): Promise<RouteSession> {
  const session = await getSessionServerFn()
  if (!session) {
    // oxlint-disable-next-line effect/noThrowStatement -- `throw redirect()` is TanStack Router's navigation control-flow API
    throw redirect({ to: '/sign-in', search: { redirect: redirectTo } })
  }
  return toRouteSession(session)
}

/**
 * Route gate for admin-only routes. Requires a session AND the Better Auth
 * admin role (`user.role === 'admin'`, see `admin({ adminRoles })` in
 * packages/auth). Non-admins get a 404 rather than a 403 so the route's
 * existence is not disclosed.
 */
export async function requireAdmin(redirectTo: string): Promise<RouteSession> {
  const session = await requireSession(redirectTo)
  if (session.user.role !== 'admin') {
    // oxlint-disable-next-line effect/noThrowStatement -- `throw notFound()` is TanStack Router's 404 control-flow API
    throw notFound()
  }
  return session
}

/**
 * Typed failure for server-function handlers on session expiry. XHR
 * mutations must not be redirected — redirects belong to navigation gates
 * (`requireSession`/`requireAdmin`) only. Server functions serialize thrown
 * errors back to the caller with `name`/`message` intact, so form callers
 * surface `message` directly (see `api-token-form.tsx`).
 */
export class UnauthorizedError extends Error {
  constructor() {
    super('Your session has expired — sign in again and retry.')
    this.name = 'UnauthorizedError'
  }
}

/**
 * Session gate for server-function handlers (already on the server, so it
 * reads the request directly instead of round-tripping through a server fn).
 * Every mutating or workspace-data server function must call this and thread
 * `{ userId: session.user.id }` into `runWorkspaceCapabilities`. Fails with
 * `UnauthorizedError` (typed, displayed by the calling form) instead of a
 * redirect.
 */
export async function requireRequestSession(): Promise<Session> {
  const session = await readSession()
  if (!session) {
    // oxlint-disable-next-line effect/noThrowStatement -- TanStack Start serializes a thrown server-fn error back to the caller; the returned Promise has no error channel
    throw new UnauthorizedError()
  }
  return session
}
