import { getLocale } from '@b2b-saas-starter/i18n/runtime'
import { DEFAULT_LOCALE, isLocale } from '@b2b-saas-starter/i18n/locale'
import { presentationSettings } from '../i18n'
import { UiError } from '../ui-error'
import { type Session } from '@b2b-saas-starter/auth'
import { redirect } from '@tanstack/react-router'
import {
  createIsomorphicFn,
  createServerFn,
  createServerOnlyFn
} from '@tanstack/react-start'
import { Effect } from 'effect'
import { currentRequest } from '../request-context'
import { readSessionFromHeaders } from './auth-session-read'

/**
 * The session read every gate below is built on — the shared one in
 * `auth-session-read.ts`, which owns the span, the `authenticated` annotation
 * and the one-read-per-request memoization the auth catchall's guards join.
 */
export const readOptionalSession = createServerOnlyFn((): Promise<Session | null> => {
  const request = currentRequest()
  // No ambient request (unit tests, scripts) means no cookie jar to read —
  // that is an unauthenticated caller, not a crash.
  if (request === undefined) {
    // oxlint-disable-next-line effect/noNewPromise -- the gate's contract is a Promise and there is no read to make: no request, no cookie jar
    return Promise.resolve(null)
  }
  return readSessionFromHeaders(request.headers)
})

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
 * (`requireSession`/`requireAdmin`) only.
 *
 * It crosses the SSR boundary through `uiErrorAdapter`, which carries the
 * `code` and the allowlisted `details` and nothing else (`lib/ui-error.ts`):
 * the constructor's sentence is a server-side diagnostic, and the client
 * rebuilds the error with the code as its message. Callers translate the
 * code (`causeMessage`) rather than displaying `message`.
 */
export class UnauthorizedError extends UiError {
  /**
   * The discriminant `Effect.catchTag` matches on: this error now travels the
   * error channel (`requireRequestSessionEffect`), and a tag is how the repo
   * distinguishes failures across module boundaries — never `instanceof`.
   */
  readonly _tag = 'UnauthorizedError'

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

/**
 * The same gate on the Effect error channel, for the enforcement points that
 * compose inside a capability effect (`server/authorize.ts`). `Effect.promise`
 * would send the expiry to the defect channel, where `catchTag` cannot see it
 * and the wide event reports a crash instead of an expired session.
 */
export function requireRequestSessionEffect(): Effect.Effect<
  Session,
  UnauthorizedError
> {
  return Effect.tryPromise({
    try: requireRequestSession,
    // Every failure of this read means the same thing to the caller: this
    // request has no session it may act on.
    catch: () => new UnauthorizedError()
  })
}
