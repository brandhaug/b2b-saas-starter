import { currentRequest } from '../request-context'
import { readOptionalSession } from './auth'
import { readClientTelemetryConfigHandler } from './telemetry-config.effects'
import { type RootData } from './root-data'

/**
 * Better Auth's default cookie prefix (packages/auth sets no
 * `advanced.cookiePrefix`), so the session cookie is
 * `better-auth.session_token` and, behind TLS, `__Secure-` prefixed. Both
 * end in this substring. If the prefix ever changes, this marker must follow
 * it, or every public page reports "signed out".
 *
 * Deliberately separate from `presentationSettings().authenticated`: the i18n
 * middleware reads the session only on account paths so guest locale detection
 * stays cookie-driven on public URLs, which leaves `<html data-authenticated>`
 * false there. Public chrome reads this flag; app chrome reads the presentation.
 */
const SESSION_COOKIE_MARKER = 'better-auth.session_token='

/**
 * The cheap half of the probe. Every public document would otherwise pay a
 * D1 round trip to learn that an anonymous visitor is anonymous; a request
 * with no session cookie cannot have a session, so it never asks.
 *
 * A present cookie proves nothing (expired, revoked, forged), which is why
 * the caller still resolves it through the real session read.
 */
function hasSessionCookie(): boolean {
  const cookie = currentRequest()?.headers.get('cookie')
  return cookie?.includes(SESSION_COOKIE_MARKER) === true
}

/**
 * Runs on the server only — it reads the worker's env bag and the request's
 * cookie jar. Reached through the dynamic `import()` in `root-data.ts`.
 */
export async function readRootDataHandler(): Promise<RootData> {
  const telemetry = readClientTelemetryConfigHandler()
  if (!hasSessionCookie()) {
    return { telemetry, signedIn: false }
  }
  // `readOptionalSession` is memoized per request, so a gated route's own
  // gate reuses this read instead of paying for a second one.
  const session = await readOptionalSession()
  return { telemetry, signedIn: session !== null }
}
