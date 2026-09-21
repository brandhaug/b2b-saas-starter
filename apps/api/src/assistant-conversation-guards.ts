import {
  AssistantApiPrincipal,
  AssistantBearerAuth
} from '@b2b-saas-starter/api/assistant-conversations'
import { RateLimiter, rateLimitBucketFor } from '@b2b-saas-starter/api'
import { Unauthorized } from '@b2b-saas-starter/api/errors'
import {
  AuthorizationDenied,
  AUTHORIZATION_DENIED_REASONS
} from '@b2b-saas-starter/authz/errors'
import {
  AssistantAuthority,
  type AssistantAuthorityDenied
} from '@b2b-saas-starter/capabilities/developer-platform/assistant-authority'
import { ConversationNotFound } from '@b2b-saas-starter/capabilities/developer-platform/assistant-conversation'
import { WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { Effect, Layer, Redacted } from 'effect'
import { HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'
import { AssistantOAuthTokenVerifier } from './assistant-oauth-access-token.ts'
import { type ApiEnv } from './env.ts'
import { enforceRateLimit, observed } from './request-guards.ts'

/** Preserve opaque resource denial while keeping credential expiry distinguishable. */
export function assistantAuthorityFailure(error: AssistantAuthorityDenied) {
  switch (error.reason) {
    case 'not_found': {
      return new ConversationNotFound()
    }
    case 'credential_expired': {
      return new Unauthorized({ message: 'assistant_credential_expired' })
    }
    case 'scope_required':
    case 'policy_denied': {
      return new AuthorizationDenied({
        reason: AUTHORIZATION_DENIED_REASONS.insufficientPermission
      })
    }
  }
}

export function assistantBearerAuth(env: ApiEnv) {
  return Layer.effect(
    AssistantBearerAuth,
    Effect.gen(function* () {
      const verifier = yield* AssistantOAuthTokenVerifier
      const authority = yield* AssistantAuthority
      const limiter = yield* RateLimiter
      return AssistantBearerAuth.of({
        assistantBearer: (httpEffect, { credential, endpoint, group }) =>
          Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest
            const gate = Effect.gen(function* () {
              const bucket = rateLimitBucketFor(group.identifier)
              if (bucket === undefined) {
                return yield* new CapabilityUnavailable({
                  capability: 'rate-limit',
                  reason: 'assistant bucket missing'
                })
              }
              yield* enforceRateLimit(request, bucket).pipe(
                Effect.provideService(RateLimiter, limiter)
              )
              const principal = yield* verifier.verify(Redacted.value(credential))
              let operation: 'read' | 'write' = 'write'
              if (endpoint.method === 'GET') {
                operation = 'read'
              }
              const context = yield* authority
                .authorize({
                  credential: principal,
                  workspaceId: principal.workspaceId,
                  requiredPermissions: ['assistant:read'],
                  operation,
                  mode: 'observe'
                })
                .pipe(
                  Effect.mapError((error) => {
                    if (error._tag === 'AssistantAuthorityDenied') {
                      return assistantAuthorityFailure(error)
                    }
                    return error
                  })
                )
              return { principal, context }
            }).pipe(
              Effect.catch((error) =>
                observed(
                  env,
                  request,
                  `assistant-conversations.${endpoint.identifier}`,
                  {},
                  Effect.fail(error)
                )
              )
            )
            const authorized = yield* gate
            return yield* httpEffect.pipe(
              Effect.provideService(AssistantApiPrincipal, authorized.principal),
              Effect.provideService(WorkspaceContext, authorized.context),
              Effect.map((response) =>
                HttpServerResponse.setHeader(
                  response,
                  'cache-control',
                  'private, no-store'
                )
              )
            )
          })
      })
    })
  )
}
