import {
  SsoConnections,
  type SsoSignInTarget
} from '@b2b-saas-starter/capabilities/governance/workspace-sso-connections'
import { Effect, Option, Schema } from 'effect'

import { runCapabilities } from '../capabilities'

/** Account login stays available. WorkspaceContext enforces required SSO. */
export function isSsoSignIn(exchange: {
  readonly method: string
  readonly pathname: string
}): boolean {
  return exchange.method === 'POST' && exchange.pathname.endsWith('/sign-in/sso')
}

function refusal(code: string, message: string, status = 403): Response {
  return Response.json({ code, message }, { status })
}

export function disabledConnectionResponse(
  target: Option.Option<SsoSignInTarget> | null
): Response | null {
  if (target === null) {
    return refusal('sso_unavailable', 'Single sign-on is temporarily unavailable.', 503)
  }
  if (Option.isNone(target)) {
    return refusal(
      'sso_connection_unavailable',
      'No available SSO connection was found.'
    )
  }
  if (!target.value.enabled) {
    return refusal(
      'sso_connection_disabled',
      'This single sign-on connection is disabled.'
    )
  }
  return null
}

const SignInBody = Schema.Struct({
  email: Schema.optional(Schema.String),
  domain: Schema.optional(Schema.String),
  providerId: Schema.optional(Schema.String),
  organizationSlug: Schema.optional(Schema.String)
})
const decodeSignInBody = Schema.decodeUnknownOption(SignInBody)

/** Reject unknown selectors as well as failed lookups before starting a flow. */
export function refuseDisabledConnection(
  request: Request,
  exchange: { readonly method: string; readonly pathname: string }
): Effect.Effect<Response | null> {
  if (!isSsoSignIn(exchange)) {
    return Effect.succeed(null)
  }
  return Effect.gen(function* () {
    const parsed = yield* Effect.promise(() =>
      request
        .clone()
        .json()
        .then(decodeSignInBody, () => Option.none())
    )
    if (Option.isNone(parsed)) {
      return refusal('invalid_sso_request', 'Provide a single sign-on connection.', 400)
    }
    const body = parsed.value
    if (body.organizationSlug !== undefined) {
      return refusal('invalid_sso_request', 'Select a verified SSO connection.', 400)
    }
    const target = yield* Effect.promise(() =>
      runCapabilities(
        Effect.flatMap(SsoConnections, (sso) => sso.resolveSignInTarget(body))
      ).then(
        (value) => value,
        () => null
      )
    )
    return disabledConnectionResponse(target)
  })
}
