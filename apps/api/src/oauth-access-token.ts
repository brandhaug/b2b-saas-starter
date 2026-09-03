import {
  MCP_RESOURCE_SCOPES,
  mcpAccessTokenPrincipal,
  type McpAccessTokenPrincipal
} from '@b2b-saas-starter/authz/mcp-access-token'
import { hasValue } from '@b2b-saas-starter/env/server'
import { Unauthorized } from '@b2b-saas-starter/api'
import { Context, Effect, Layer, type Scope } from 'effect'
import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from 'jose'

import { type ApiEnv } from './env.ts'

/**
 * The OAuth half of `/mcp` authentication (ADR 0054): a Bearer JWT minted by
 * the web worker's `@better-auth/mcp` authorization server, verified here as
 * the resource server. API Tokens remain the other half — see
 * `request-guards.ts`, which routes a credential to one or the other by shape.
 *
 * Verification is jose's: signature against the issuer's JWKS, `iss`, `aud`
 * (this worker's `/mcp` URL), `exp`/`nbf`. What the starter itself stamped —
 * the workspace claims and the `mcp:read` scope — is checked by
 * `mcpAccessTokenPrincipal` from `@b2b-saas-starter/authz`, the contract both
 * workers share.
 */

export type OAuthResourceConfig = {
  /** The authorization server: the web worker's Better Auth base URL (`…/api/auth`). */
  readonly issuer: string
  /** This worker's `/mcp` URL, the token audience. */
  readonly audience: string
  readonly jwksUrl: string
}

/**
 * Both env vars set, or the OAuth path stays inactive: with no issuer there is
 * nothing to trust, and with no resource URL no audience to demand.
 */
export function oauthResourceConfig(env: ApiEnv): OAuthResourceConfig | undefined {
  const issuer = env.MCP_OAUTH_ISSUER
  const audience = env.MCP_RESOURCE_URL
  if (!hasValue(issuer) || !hasValue(audience)) {
    return undefined
  }
  const trimmedIssuer = issuer.replace(/\/$/, '')
  return { issuer: trimmedIssuer, audience, jwksUrl: `${trimmedIssuer}/jwks` }
}

/**
 * RFC 9728 Protected Resource Metadata — what an MCP client fetches from
 * `/.well-known/oauth-protected-resource[/mcp]` to learn where to authorize.
 * Served by this worker because the resource lives here, not on the
 * authorization server's origin.
 */
export function protectedResourceMetadata(config: OAuthResourceConfig) {
  return {
    resource: config.audience,
    authorization_servers: [config.issuer],
    scopes_supported: [...MCP_RESOURCE_SCOPES],
    bearer_methods_supported: ['header'],
    resource_name: 'B2B SaaS Starter MCP'
  }
}

/** Where a client goes after a 401: the metadata URL, in the RFC 9728 `WWW-Authenticate` shape. */
export function oauthChallengeHeader(origin: string): string {
  return `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`
}

/**
 * The asymmetric algorithms Better Auth's jwt plugin can sign with. Pinned so a
 * key set entry with any other `alg` — or a token claiming `none` — is refused
 * before a signature is even checked.
 */
const ACCEPTED_ALGORITHMS: ReadonlyArray<string> = [
  'EdDSA',
  'ES256',
  'ES512',
  'PS256',
  'RS256'
]

export type OAuthTokenVerifierInterface = {
  readonly verify: (
    token: string
  ) => Effect.Effect<McpAccessTokenPrincipal, Unauthorized, Scope.Scope>
}

export class OAuthTokenVerifier extends Context.Service<
  OAuthTokenVerifier,
  OAuthTokenVerifierInterface
>()('@b2b-saas-starter/api/OAuthTokenVerifier') {}

/** A JWT is three base64url segments; an API Token is `bsk_…` and has none. */
export function looksLikeJwt(token: string): boolean {
  return token.split('.').length === 3
}

function rejectionReason(cause: unknown): string {
  if (cause instanceof errors.JWTExpired) {
    return 'access_token_expired'
  }
  if (cause instanceof errors.JWTClaimValidationFailed) {
    return `access_token_${cause.claim}_mismatch`
  }
  if (cause instanceof errors.JOSEError) {
    return 'invalid_access_token'
  }
  return 'invalid_access_token'
}

/**
 * A verifier over an explicit key source, so tests hand it a local key set
 * (`createLocalJWKSet`) and the layer below hands it the cached remote one.
 */
export function makeOAuthTokenVerifier(
  config: Pick<OAuthResourceConfig, 'issuer' | 'audience'>,
  getKey: JWTVerifyGetKey
): OAuthTokenVerifierInterface {
  return {
    verify: (token) =>
      Effect.gen(function* () {
        const verified = yield* Effect.tryPromise({
          try: () =>
            jwtVerify(token, getKey, {
              issuer: config.issuer,
              audience: config.audience,
              algorithms: [...ACCEPTED_ALGORITHMS]
            }),
          catch: (cause) => new Unauthorized({ message: rejectionReason(cause) })
        })
        const outcome = mcpAccessTokenPrincipal(verified.payload)
        if (!outcome.ok) {
          yield* Effect.annotateLogsScoped({ authReason: outcome.reason })
          return yield* Effect.fail(new Unauthorized({ message: outcome.reason }))
        }
        return outcome.principal
      })
  }
}

/** The inactive verifier: every JWT is refused with one reason, and no key set is ever fetched. */
const inactiveVerifier: OAuthTokenVerifierInterface = {
  verify: () => Effect.fail(new Unauthorized({ message: 'oauth_not_configured' }))
}

/**
 * Built once per isolate (it rides the isolate-level capability layer in
 * `http.ts`), so jose's remote key set — which caches keys and refetches only
 * on an unknown `kid`, at most every thirty seconds — lives as long as the
 * isolate does. Unconfigured, the OAuth path is inactive and `/mcp` accepts
 * API Tokens alone (CLAUDE.md rule 3).
 */
export function makeOAuthTokenVerifierLayer(
  env: ApiEnv
): Layer.Layer<OAuthTokenVerifier> {
  const config = oauthResourceConfig(env)
  if (config === undefined) {
    return Layer.succeed(OAuthTokenVerifier)(inactiveVerifier)
  }
  const keySet = createRemoteJWKSet(new URL(config.jwksUrl), {
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60_000
  })
  return Layer.succeed(OAuthTokenVerifier)(makeOAuthTokenVerifier(config, keySet))
}
