import { Unauthorized } from '@b2b-saas-starter/api/errors'
import {
  ASSISTANT_RESOURCE_SCOPES,
  assistantAccessTokenPrincipal,
  type AssistantOAuthPrincipal
} from '@b2b-saas-starter/authz/assistant-access-token'
import { hasValue } from '@b2b-saas-starter/env/server'
import { Context, Effect, Layer } from 'effect'
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'
import {
  hasOAuthResourceAudience,
  type OAuthResourceConfig
} from './oauth-access-token.ts'
import { type ApiEnv } from './env.ts'

export function assistantOAuthResourceConfig(
  env: ApiEnv
): OAuthResourceConfig | undefined {
  if (!hasValue(env.MCP_OAUTH_ISSUER) || !hasValue(env.ASSISTANT_RESOURCE_URL)) {
    return undefined
  }
  const issuer = env.MCP_OAUTH_ISSUER.replace(/\/$/, '')
  return { issuer, audience: env.ASSISTANT_RESOURCE_URL, jwksUrl: `${issuer}/jwks` }
}

export function assistantProtectedResourceMetadata(config: OAuthResourceConfig) {
  return {
    resource: config.audience,
    authorization_servers: [config.issuer],
    scopes_supported: ASSISTANT_RESOURCE_SCOPES,
    bearer_methods_supported: ['header'],
    resource_name: 'Private assistant conversations'
  }
}

export class AssistantOAuthTokenVerifier extends Context.Service<
  AssistantOAuthTokenVerifier,
  {
    readonly verify: (
      token: string
    ) => Effect.Effect<AssistantOAuthPrincipal, Unauthorized>
  }
>()('@b2b-saas-starter/api/AssistantOAuthTokenVerifier') {}

export function makeAssistantOAuthTokenVerifier(
  config: Pick<OAuthResourceConfig, 'issuer' | 'audience'>,
  getKey: JWTVerifyGetKey
): AssistantOAuthTokenVerifier['Service'] {
  return {
    verify: Effect.fn('AssistantOAuthTokenVerifier.verify')(function* (token) {
      const verified = yield* Effect.tryPromise({
        try: () =>
          jwtVerify(token, getKey, {
            issuer: config.issuer,
            audience: config.audience,
            requiredClaims: ['exp', 'sub', 'aud'],
            algorithms: ['EdDSA', 'ES256', 'ES512', 'PS256', 'RS256']
          }),
        catch: () => new Unauthorized({ message: 'invalid_assistant_access_token' })
      })
      // The persisted reference names this resource, never the ancillary OIDC audience.
      const principal = assistantAccessTokenPrincipal({
        ...verified.payload,
        aud: config.audience
      })
      if (
        principal === null ||
        !hasOAuthResourceAudience(verified.payload.aud, config, principal.scopes)
      ) {
        return yield* new Unauthorized({ message: 'invalid_assistant_access_token' })
      }
      return principal
    })
  }
}

export function makeAssistantOAuthTokenVerifierLayer(
  env: ApiEnv
): Layer.Layer<AssistantOAuthTokenVerifier> {
  const config = assistantOAuthResourceConfig(env)
  if (
    !config ||
    (env.ENVIRONMENT === 'production' && !config.jwksUrl.startsWith('https:'))
  ) {
    return Layer.succeed(AssistantOAuthTokenVerifier)({
      verify: () =>
        Effect.fail(new Unauthorized({ message: 'assistant_oauth_not_configured' }))
    })
  }
  return Layer.succeed(AssistantOAuthTokenVerifier)(
    makeAssistantOAuthTokenVerifier(
      config,
      createRemoteJWKSet(new URL(config.jwksUrl), {
        cooldownDuration: 30_000,
        cacheMaxAge: 600_000
      })
    )
  )
}
