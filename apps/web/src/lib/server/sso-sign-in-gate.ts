import {
  SsoConnections,
  type SsoSignInTarget
} from '@b2b-saas-starter/capabilities/governance/workspace-sso-connections'
import { Effect, Option, Schema } from 'effect'

import { runCapabilities } from '../capabilities'
import { authRefusal } from './auth-refusal'

/**
 * The server-side half of the domain-routing rule (ADR 0069), enforced at the
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
 *
 * The two halves disagree about a failed lookup on purpose: the require-SSO
 * refusal fails **open** (a password sign-in the routing rule would have
 * redirected is the worst case), the disabled-connection refusal fails
 * **closed** (starting the IdP flow for a connection nobody could read is
 * exactly what "a disabled connection never intercepts sign-ins" forbids).
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
  return authRefusal(403, code, { message })
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
 *
 * Unlike the require-SSO half this decision has no "no decision" input: an
 * unresolved connection is a refusal (`unresolvedConnectionResponse`), because
 * letting the flow start would hand the sign-in to the very connection this
 * gate exists to keep inert.
 */
export function disabledConnectionResponse(
  target: Option.Option<SsoSignInTarget>
): Response | null {
  if (Option.isNone(target) || target.value.enabled) {
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

/** The routing keys the capability resolves a connection from. */
type RoutingKeys = {
  readonly email?: string | undefined
  readonly domain?: string | undefined
  readonly providerId?: string | undefined
}

/**
 * The resolution the capability answers, or the read's own failure — which the
 * two wrappers below treat differently on purpose.
 */
// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class SsoResolutionUnavailable extends Schema.TaggedError<SsoResolutionUnavailable>()(
  'SsoResolutionUnavailable',
  {}
) {}

function resolveTarget(
  body: RoutingKeys
): Effect.Effect<Option.Option<SsoSignInTarget>, SsoResolutionUnavailable> {
  return Effect.tryPromise({
    try: () =>
      runCapabilities(
        Effect.flatMap(SsoConnections, (sso) => sso.resolveSignInTarget(body))
      ),
    catch: () => new SsoResolutionUnavailable()
  })
}

/**
 * The require-SSO half's read: an unavailable capability folds to `null` ("no
 * decision") rather than locking every credential sign-in behind one table
 * read. Fail-open is the deliberate choice here — the worst case is a
 * password sign-in the routing rule would have redirected, and the IdP path
 * stays available either way.
 */
function resolveTargetOrNull(
  body: RoutingKeys
): Effect.Effect<Option.Option<SsoSignInTarget> | null> {
  return resolveTarget(body).pipe(Effect.catch(() => Effect.succeed(null)))
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
    return ssoRequiredResponse(yield* resolveTargetOrNull({ email: body.email }))
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
  }).pipe(
    // Fail closed: an SSO sign-in whose connection could not be read must not
    // start the IdP flow on the chance that the connection is enabled.
    Effect.catch(() => Effect.succeed(unresolvedConnectionResponse()))
  )
}

/** The 503 the SSO half answers when the connection could not be resolved. */
export function unresolvedConnectionResponse(): Response {
  return authRefusal(503, 'sso_connection_unavailable', {
    message: 'Single sign-on is unavailable right now. Try again in a moment.'
  })
}
