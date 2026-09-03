import { SsoConnections } from '@b2b-saas-starter/capabilities/governance/workspace-sso-connections'
import { Effect, Option, Schema } from 'effect'

import { runCapabilities } from '../capabilities'

/**
 * The server-side half of "require SSO for this domain" (ADR 0054): a
 * workspace that flips the toggle refuses the credential path for its domain
 * outright, at the auth boundary, so a direct `POST /sign-in/email` cannot
 * sidestep the routing the sign-in page applies. The Turnstile gate in
 * `api.auth.$.ts` is the precedent for a pre-handler check ahead of Better
 * Auth — this module owns the SSO variant.
 *
 * The check reads the email out of a *cloned* body (Better Auth is about to
 * consume the original) and only ever answers `sso_required` for a domain
 * whose connection both routes and demands SSO. Domains without a connection
 * answer identically to a starter with no SSO at all: `null`, and the request
 * proceeds untouched.
 */

/** Whether an auth-catchall exchange is the credential sign-in this gates. */
export function isCredentialSignIn(exchange: {
  readonly method: string
  readonly pathname: string
}): boolean {
  return exchange.method === 'POST' && exchange.pathname.endsWith('/sign-in/email')
}

export function enforceSsoRequired(
  request: Request,
  exchange: { readonly method: string; readonly pathname: string }
): Effect.Effect<Response | null> {
  if (!isCredentialSignIn(exchange)) {
    return Effect.succeed(null)
  }
  return Effect.gen(function* () {
    const email = yield* readEmail(request)
    if (email === null) {
      // Better Auth's own validation will answer a missing email; nothing
      // here needs to duplicate it.
      return null
    }
    // The routing ask never refuses the request on its own failure: an
    // unavailable capability falls through to the credential path rather
    // than locking every sign-in behind one table read — hence the `then`
    // fallback that folds a rejection into "no decision".
    const decision = yield* Effect.promise(() =>
      runCapabilities(
        Effect.flatMap(SsoConnections, (sso) => sso.resolveRouting(email))
      ).then(
        (value) => value,
        () => null
      )
    )
    if (decision === null || Option.isNone(decision) || !decision.value.requireSso) {
      return null
    }
    return new Response(
      JSON.stringify({
        error: 'sso_required',
        message: 'This workspace requires single sign-on for your email domain.'
      }),
      {
        status: 403,
        headers: { 'content-type': 'application/json; charset=utf-8' }
      }
    )
  })
}

/** The request body's email, parsed at this I/O boundary. */
const SignInBody = Schema.Struct({ email: Schema.String })
const decodeSignInBody = Schema.decodeUnknownOption(SignInBody)

/** The request body's email, or null for an unparseable / emailless body. */
function readEmail(request: Request): Effect.Effect<string | null> {
  return Effect.promise(() =>
    request
      .clone()
      .json()
      .then(
        (body) => {
          const decoded = decodeSignInBody(body)
          return Option.isSome(decoded) ? decoded.value.email : null
        },
        () => null
      )
  )
}
