import { getLocale } from '@b2b-saas-starter/i18n/runtime'
import { DEFAULT_LOCALE, isLocale } from '@b2b-saas-starter/i18n/locale'
import { presentationSettings } from '../i18n'
import { UiError } from '../ui-error'
import { Auth, type Session } from '@b2b-saas-starter/auth'
import { redirect } from '@tanstack/react-router'
import {
  createIsomorphicFn,
  createServerFn,
  createServerOnlyFn
} from '@tanstack/react-start'
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
export const readOptionalSession = createServerOnlyFn((): Promise<Session | null> =>
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

const getSessionServerFn = createServerFn({ method: 'GET' }).handler(
  readOptionalSession
)

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
    readonly name: string
    readonly email: string
    readonly emailVerified: boolean
    readonly role: string
    readonly twoFactorEnabled: boolean
  }
  /**
   * The System Admin whose impersonation session this is (ADR 0054), or
   * `null` for an ordinary session. The shell's banner and the account page's
   * hidden controls read it; the server re-checks the real session anyway.
   */
  readonly impersonatedBy: string | null
}

/**
 * Strips a Better Auth session down to `RouteSession`. Exported so the
 * projection's shape is asserted by test rather than trusted.
 */
export function toRouteSession(session: Session): RouteSession {
  return {
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      // The plugin schema marks these optional; the gate only ever reads
      // them as scalars, so normalize to definite values here.
      emailVerified: session.user.emailVerified,
      role: session.user.role ?? '',
      twoFactorEnabled: session.user.twoFactorEnabled ?? false
    },
    impersonatedBy: session.session.impersonatedBy ?? null
  }
}

/** Entering the app from a public translation must use the saved account settings. */
const synchronizePresentation = createIsomorphicFn()
  .server((_session: Session, _href: string) => undefined)
  .client((session: Session, href: string) => {
    const settings = presentationSettings()
    const accountLocale = isLocale(session.user.locale)
      ? session.user.locale
      : DEFAULT_LOCALE
    const localeChanged = accountLocale !== getLocale()
    const zoneChanged =
      session.user.timeZone !== null &&
      session.user.timeZone !== undefined &&
      session.user.timeZone !== settings.timeZone
    if (localeChanged || zoneChanged || !settings.authenticated) {
      // oxlint-disable-next-line effect/noThrowStatement -- full document navigation establishes account presentation before rendering gated content
      throw redirect({ href, reloadDocument: true })
    }
  })

/**
 * Route gate for `beforeLoad`. Redirects unauthenticated visitors to
 * `/sign-in` and returns the projected session so loaders can pass the actor
 * to `runWorkspaceCapabilities`. `loadSession` is injectable because the
 * server fn it defaults to only runs inside a request —
 * `auth-runtime.test.ts` drives the gate with the degraded runtime's own
 * null answer.
 */
export async function requireSession(
  redirectTo: string,
  loadSession: () => Promise<Session | null> = getSessionServerFn
): Promise<RouteSession> {
  const session = await loadSession()
  if (!session) {
    // oxlint-disable-next-line effect/noThrowStatement -- `throw redirect()` is TanStack Router's navigation control-flow API
    throw redirect({ to: '/sign-in', search: { redirect: redirectTo } })
  }
  synchronizePresentation(session, redirectTo)
  return toRouteSession(session)
}

/**
 * Typed failure for server-function handlers on session expiry. XHR
 * mutations must not be redirected — redirects belong to navigation gates
 * (`requireSession`/`requireAdmin`) only. Server functions serialize thrown
 * errors back to the caller with `name`/`message` intact, so form callers
 * surface `message` directly (see `api-token-form.tsx`).
 */
export class UnauthorizedError extends UiError {
  constructor() {
    super('unauthorized', {}, 'Your session has expired. Sign in again and retry.')
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
  const session = await readOptionalSession()
  if (!session) {
    // oxlint-disable-next-line effect/noThrowStatement -- TanStack Start serializes a thrown server-fn error back to the caller; the returned Promise has no error channel
    throw new UnauthorizedError()
  }
  return session
}
