import {
  SsoConnections,
  type SsoSignInTarget
} from '@b2b-saas-starter/capabilities/governance/workspace-sso-connections'
import { Effect, Option, Schema } from 'effect'

import { runCapabilities } from '../capabilities'

/**
 * The server-side half of the domain-routing rule (ADR 0055), enforced at the
 * auth boundary for both of Better Auth's sign-in paths:
 *
 * - `POST /sign-in/email` — a workspace that flipped "require SSO for this
 *   domain" refuses the credential path outright, so a direct POST cannot
 *   sidestep the routing the sign-in page applies.
 * - `POST /sign-in/sso` — the plugin serves any stored connection, so a
 *   **disabled** one (born disabled pending its test, or retired by an
 *   owner) is refused here: "a disabled connection never intercepts
 *   sign-ins" holds at the boundary, not just on the page.
 *
 * The Turnstile gate in `api.auth.$.ts` is the precedent for a pre-handler
 * check ahead of Better Auth — this module owns the SSO pair. Refusal bodies
 * use Better Auth's own error convention — `{ code, message }`, what
 * `better-call` serializes an `APIError` into — which is also the shape the
 * sign-in page probes.
 *
 * The decisions are pure functions over the sign-in resolution; the
 * request-shaped wrappers add only the body parse and the capability lookup.
 * That split is what keeps them testable without an auth runtime.
 */

/** Whether an auth-catchall exchange is the credential sign-in this gates. */
export function isCredentialSignIn(exchange: {
  readonly method: string
  readonly pathname: string
}): boolean {
  return exchange.method === 'POST' && exchange.pathname.endsWith('/sign-in/email')
}

/** Whether an auth-catchall exchange is the SSO sign-in this gates. */
export function isSsoSignIn(exchange: {
  readonly method: string
  readonly pathname: string
}): boolean {
  return exchange.method === 'POST' && exchange.pathname.endsWith('/sign-in/sso')
}

/** Better Auth's error-body convention, at the one status both gates use. */
function refusal(code: string, message: string): Response {
  return new Response(JSON.stringify({ code, message }), {
    status: 403,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  })
}

/**
 * The 403 when the resolved connection demands SSO, else `null` — including
 * when the resolution itself failed (`null`): a failed ask never refuses a
 * sign-in, it falls through to Better Auth.
 */
export function ssoRequiredResponse(
  target: Option.Option<SsoSignInTarget> | null
): Response | null {
  if (target === null || Option.isNone(target) || !target.value.requireSso) {
    return null
  }
  return refusal(
    'sso_required',
    'This workspace requires single sign-on for your email domain.'
  )
}

/**
 * The 403 when the resolved connection is **disabled**, else `null` — the
 * plugin would start the flow for it anyway, and this is what makes a
 * retired or not-yet-tested connection inert for sign-ins, matching the
 * page-level routing rule.
 */
export function disabledConnectionResponse(
  target: Option.Option<SsoSignInTarget> | null
): Response | null {
  if (target === null || Option.isNone(target) || target.value.enabled) {
    return null
  }
  return refusal(
    'sso_connection_disabled',
    'Single sign-on for this domain is disabled. Sign in with your email and password.'
  )
}

/**
 * The sign-in request's routing keys, parsed at this I/O boundary. Extra
 * keys (password, callbackURL, …) are ignored.
 */
const SignInBody = Schema.Struct({
  email: Schema.optional(Schema.String),
  domain: Schema.optional(Schema.String),
  providerId: Schema.optional(Schema.String),
  organizationSlug: Schema.optional(Schema.String)
})
type SignInBody = typeof SignInBody.Type
const decodeSignInBody = Schema.decodeUnknownOption(SignInBody)

/** The request body's sign-in keys, or `null` for an unparseable body. */
function readBody(request: Request): Effect.Effect<SignInBody | null> {
  return Effect.promise(() =>
    request
      .clone()
      .json()
      .then(
        (parsed) => {
          const decoded = decodeSignInBody(parsed)
          return Option.isSome(decoded) ? decoded.value : null
        },
        () => null
      )
  )
}

/**
 * The sign-in resolution both wrappers read, via the capability's
 * identity-keyed `resolveSignInTarget`. An unavailable capability folds to
 * `null` ("no decision") rather than locking every sign-in behind one table
 * read.
 */
function resolveTarget(body: {
  readonly email?: string | undefined
  readonly domain?: string | undefined
  readonly providerId?: string | undefined
}): Effect.Effect<Option.Option<SsoSignInTarget> | null> {
  return Effect.promise(() =>
    runCapabilities(
      Effect.flatMap(SsoConnections, (sso) => sso.resolveSignInTarget(body))
    ).then(
      (value) => value,
      () => null
    )
  )
}

/** The credential half: refuse `POST /sign-in/email` for a require-SSO domain. */
export function enforceSsoRequired(
  request: Request,
  exchange: { readonly method: string; readonly pathname: string }
): Effect.Effect<Response | null> {
  if (!isCredentialSignIn(exchange)) {
    return Effect.succeed(null)
  }
  return Effect.gen(function* () {
    const body = yield* readBody(request)
    if (body?.email === undefined) {
      // Better Auth's own validation will answer a missing email; nothing
      // here needs to duplicate it.
      return null
    }
    return ssoRequiredResponse(yield* resolveTarget({ email: body.email }))
  })
}

/** The SSO half: refuse `POST /sign-in/sso` that resolves to a disabled connection. */
export function refuseDisabledConnection(
  request: Request,
  exchange: { readonly method: string; readonly pathname: string }
): Effect.Effect<Response | null> {
  if (!isSsoSignIn(exchange)) {
    return Effect.succeed(null)
  }
  return Effect.gen(function* () {
    const body = yield* readBody(request)
    if (body === null) {
      return null
    }
    if (
      body.organizationSlug !== undefined &&
      body.email === undefined &&
      body.domain === undefined &&
      body.providerId === undefined
    ) {
      // An organizationSlug addresses one workspace outright — the app never
      // issues it, and the domain-routing rule does not govern it.
      return null
    }
    return disabledConnectionResponse(yield* resolveTarget(body))
  })
}
