import { Auth } from '@b2b-saas-starter/auth'
import { Effect } from 'effect'

import { authRuntime } from '../auth-runtime'
import {
  TWO_FACTOR_REQUIRED_ERROR_CODE,
  TWO_FACTOR_REQUIRED_MESSAGE
} from '../two-factor-refusal'
import { withWebRequestScope } from '../observability'
import { type AuthExchange } from './auth-audit/exchanges'

/**
 * The two-factor gate for the two mailbox-only sign-ins: the emailed one-time
 * code (`POST /sign-in/email-otp`) and the emailed single-use link
 * (`GET /magic-link/verify`). Either one proves mailbox possession and
 * nothing else, yet both mint a full session even when the account has TOTP
 * on — the twoFactor plugin's challenge hook matches the credential sign-in
 * endpoints only, so these paths have no challenge hop of their own. This
 * module is that hop, enforced at the auth catchall.
 *
 * Scope, stated honestly:
 *
 * - Passkey sign-in still bypasses the second factor deliberately
 *   (ADR 0056): the WebAuthn ceremony is itself a possession factor, and the
 *   plugin creates that session directly.
 * - Social and SSO sign-ins stay ungated here: the second factor for those
 *   identities belongs to the IdP that proved them (ADR 0069 / ADR 0070).
 *
 * Post-handler on purpose, which is what keeps the gate free of an
 * enumeration oracle: it runs only where Better Auth already answered
 * SUCCESS — a request that failed the plugin's own checks (unknown address,
 * wrong code, bad token) passes through byte for byte, and the refusal
 * replaces a response only the mailbox's owner could have provoked.
 *
 * Like `sso-sign-in-gate.ts`, the decisions are pure functions over the
 * exchange and response; the one wrapper adds only the session read and the
 * revocation, so the decision core is testable without an auth runtime.
 */

/** Whether an auth-catchall exchange is the emailed-code sign-in this gates. */
export function isEmailOtpSignIn(exchange: {
  readonly method: string
  readonly pathname: string
}): boolean {
  return exchange.method === 'POST' && exchange.pathname.endsWith('/sign-in/email-otp')
}

/** Whether an auth-catchall exchange is the magic-link consume hop this gates. */
export function isMagicLinkVerify(exchange: {
  readonly method: string
  readonly pathname: string
}): boolean {
  return exchange.method === 'GET' && exchange.pathname.endsWith('/magic-link/verify')
}

/**
 * Whether the handler's response is a success shape — the only thing the
 * gate may refuse. The POST answers JSON (2xx is its success); the GET
 * answers a redirect (3xx), with a JSON 2xx accepted in case a callback
 * shape ever lands. Everything else, including every failure, is untouched.
 */
export function isSessionMintingSuccess(
  exchange: {
    readonly method: string
    readonly pathname: string
  },
  response: Response
): boolean {
  if (isEmailOtpSignIn(exchange)) {
    return response.ok
  }
  if (isMagicLinkVerify(exchange)) {
    return response.status >= 200 && response.status < 400
  }
  return false
}

/**
 * The session-token cookie(s) the response set, as a `cookie` header value —
 * the credential the gate must read and then revoke. Better Auth names it
 * `better-auth.session_token` (`__Secure-`-prefixed behind HTTPS); matching
 * the `session_token` fragment rather than the full name keeps both
 * spellings one rule, same as the SSO sign-in audit's cookie reader.
 */
export function responseSessionCookies(response: Response): string | null {
  const pairs: Array<string> = []
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';')[0]
    if (cookie.includes('session_token') && pair !== undefined) {
      pairs.push(pair)
    }
  }
  if (pairs.length === 0) {
    return null
  }
  return pairs.join('; ')
}

/**
 * The refusal for a session the gate will not leave standing, or `null` for
 * an exchange it does not govern. Both shapes follow the flow they interrupt:
 * the POST gets Better Auth's `{ code, message }` error body (what the
 * code-based sign-in UI probes), the GET gets the redirect every other
 * magic-link outcome already uses, so the sign-in page renders this through
 * the same `error` param it renders the plugin's own. Neither carries a
 * `Set-Cookie` — the minted session must not survive its own refusal.
 */
export function twoFactorRefusal(exchange: {
  readonly method: string
  readonly pathname: string
}): Response | null {
  if (isEmailOtpSignIn(exchange)) {
    return new Response(
      JSON.stringify({
        code: TWO_FACTOR_REQUIRED_ERROR_CODE,
        message: TWO_FACTOR_REQUIRED_MESSAGE
      }),
      { status: 403, headers: { 'content-type': 'application/json; charset=utf-8' } }
    )
  }
  if (isMagicLinkVerify(exchange)) {
    return new Response(null, {
      status: 302,
      headers: { location: `/sign-in?error=${TWO_FACTOR_REQUIRED_ERROR_CODE}` }
    })
  }
  return null
}

/**
 * The gate: `null` when the handler's response stands, the refusal when it
 * does not. The session read follows `readPreHandlerSession` in
 * `api.auth.$.ts` — a failed read must never fail the auth request it
 * observes, so any error resolves `null` and the minted response passes
 * through (better a session than a broken sign-in; the audit row still
 * records it).
 */
export function enforceTwoFactorSignIn(
  exchange: AuthExchange,
  response: Response
): Effect.Effect<Response | null> {
  if (!isSessionMintingSuccess(exchange, response)) {
    return Effect.succeed(null)
  }
  return Effect.promise(() => refuseMintedSession(exchange, response))
}

/**
 * The post-handler half: read the session the handler's response minted, and
 * refuse it when the account carries a second factor. The revocation is the
 * one write — the refusal drops the handler's `Set-Cookie`, so the browser
 * never stores the token, but the session row is a live credential until it
 * is deleted and the token did transit the wire inside the response headers.
 * `signOut` is the simplest correct revocation: it deletes exactly the
 * session this cookie proves. Best-effort, with the refusal returned either
 * way — a revocation failure must not turn a refusal into a pass-through.
 */
async function refuseMintedSession(
  exchange: AuthExchange,
  response: Response
): Promise<Response | null> {
  const cookie = responseSessionCookies(response)
  if (cookie === null) {
    // Nothing session-shaped was minted (a failure redirect lands here too).
    return null
  }
  const headers = new Headers({ cookie })
  return authRuntime
    .runPromise(
      withWebRequestScope(
        { event: 'auth.two_factor_gate' },
        Effect.gen(function* () {
          const auth = yield* Auth.Tag
          const session = yield* auth.api.getSession({ headers })
          if (session === null || session.user.twoFactorEnabled !== true) {
            return null
          }
          yield* Effect.result(auth.api.signOut({ headers }))
          return twoFactorRefusal(exchange)
        })
      )
    )
    .catch(() => null)
}
