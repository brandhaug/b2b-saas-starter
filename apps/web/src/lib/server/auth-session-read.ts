import { Auth, type Session } from '@b2b-saas-starter/auth'
import { errorMessage } from '@b2b-saas-starter/failure'
import { Effect, Schema } from 'effect'

import { authRuntime } from '../auth-runtime'
import { memoizePerRequest, withWebRequestScope } from '../observability'

/**
 * The one Better Auth session read in the web app. The route gates
 * (`server/auth.ts`), the auth catchall's pre-handler guards
 * (`auth-request-guard.ts`) and the two-factor gate
 * (`two-factor-sign-in-gate.ts`) all reach the plugin through here, so the
 * span, the `authenticated` annotation and the per-request memoization are one
 * decision instead of three near-identical copies.
 *
 * `authRuntime` carries the `Auth` service only, so the observability scope has
 * to come from the request: `withWebRequestScope` makes this a child span of
 * the request span and folds the read's outcome into that request's one wide
 * event.
 */

/**
 * The read itself failed — the database was unreachable, the plugin threw.
 * Deliberately distinct from a successful read that found no session: a gate
 * that cannot tell them apart treats a broken read as an anonymous request and
 * waves the request through (see `sessionFromHeaders`).
 */
// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class SessionReadFailed extends Schema.TaggedError<SessionReadFailed>()(
  'SessionReadFailed',
  { reason: Schema.String }
) {}

const READ_FAILED_REASON = 'the session read failed'

function runSessionRead(headers: Headers): Promise<Session | null> {
  return authRuntime.runPromise(
    withWebRequestScope(
      { event: 'auth.session' },
      Effect.gen(function* () {
        const auth = yield* Auth.Tag
        const session = yield* auth.api.getSession({ headers })
        // Whether the read found a session is the useful fact. Never the
        // token, never the email.
        yield* Effect.annotateLogsScoped({ authenticated: session !== null })
        return session
      })
    )
  )
}

/**
 * The session the request's own cookie jar proves, once per request.
 *
 * One read per request through `memoizePerRequest`: a route whose `beforeLoad`
 * gate, a server function and the auth catchall's pre-handler guards all read
 * the same session must not pay three DB round-trips for one document request.
 * Slots live on the request's telemetry, so they survive Start re-wrapping the
 * `Request` mid-flight. Rejects when the read fails.
 */
export function readSessionFromHeaders(headers: Headers): Promise<Session | null> {
  return memoizePerRequest('auth.session', () => runSessionRead(headers))
}

/**
 * The same read, Effect-shaped, with the failure on the error channel: the
 * pre-handler guards refuse the request rather than mistake a broken read for
 * an anonymous one.
 */
export function sessionFromHeaders(
  headers: Headers
): Effect.Effect<Session | null, SessionReadFailed> {
  return Effect.tryPromise({
    try: () => readSessionFromHeaders(headers),
    catch: (cause) =>
      new SessionReadFailed({ reason: errorMessage(cause) ?? READ_FAILED_REASON })
  })
}

/**
 * A read for a credential that is NOT the request's own cookie jar: the
 * two-factor gate reads the session Better Auth just minted, off the
 * `Set-Cookie` it is about to refuse. Deliberately unmemoized — the request's
 * `auth.session` slot answers for the caller's cookies, and a minted token
 * must never overwrite it (nor be answered from it).
 */
export function readSessionForCookie(cookie: string): Promise<Session | null> {
  return runSessionRead(new Headers({ cookie }))
}
