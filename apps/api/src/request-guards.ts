import {
  WorkspaceSuspensionService,
  workspaceSuspensionOperationForPermission
} from '@b2b-saas-starter/capabilities/governance/workspace-suspension'
import { annotateWideEvent, annotateWideEventCause } from '@b2b-saas-starter/logger'
import { requirePermission } from '@b2b-saas-starter/authz/guard'
import { tokenPrincipal, type PermissionRequest } from '@b2b-saas-starter/authz/client'
import { ApiTokenRegistry } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { type WorkspaceSuspended } from '@b2b-saas-starter/capabilities/errors'
import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { selectWorkspaceContextLayer } from '@b2b-saas-starter/capabilities/runtime'
import { type WorkspaceCaller } from '@b2b-saas-starter/capabilities/workspace-context'
import {
  AUTHORIZATION_DENIED_REASONS,
  AuthorizationDenied
} from '@b2b-saas-starter/authz/errors'
import { Cause, Effect, Layer, Redacted, Result, type Scope } from 'effect'
import { HttpServerRequest } from 'effect/http'

import {
  ApiPrincipal,
  BearerAuth,
  rateLimitBucketFor,
  RateLimiter,
  type ApiPrincipalValue,
  type RateLimitBucket
} from '@b2b-saas-starter/api'
import { RateLimited, Unauthorized } from '@b2b-saas-starter/api/errors'
import { clientKey } from '@b2b-saas-starter/rate-limit'
import { starterEnv, type ApiEnv } from './env.ts'

/**
 * The per-request enforcement helpers shared by every served surface — the
 * `StarterApi` contract groups in `handlers.ts` *and* the raw MCP protocol
 * route (`mcp-credential-gate.ts`, `mcp-caller.ts`). One authenticate path, one rate-limit path, one wide-event
 * envelope: a new surface cannot grow a second, weaker gate.
 */

export function bearerToken(
  request: HttpServerRequest.HttpServerRequest
): string | null {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return null
  }
  return header.slice('Bearer '.length).trim()
}

export function enforceRateLimit(
  request: HttpServerRequest.HttpServerRequest,
  bucket: RateLimitBucket
): Effect.Effect<void, RateLimited, RateLimiter | Scope.Scope> {
  return enforceRateLimitKey(bucket, clientKey(webRequest(request)))
}

/** Value-based guard shared by HTTP routes and individual MCP calls. */
export const enforceRateLimitKey = Effect.fn('Api.enforceRateLimitKey')(function* (
  bucket: RateLimitBucket,
  key: string
): Effect.fn.Return<void, RateLimited, RateLimiter | Scope.Scope> {
  const limiter = yield* RateLimiter
  const allowed = yield* limiter.take({ bucket, key })
  if (!allowed) {
    yield* annotateWideEvent({
      outcome: 'rate_limited',
      rateLimitBucket: bucket
    })
    return yield* Effect.fail(new RateLimited({ bucket }))
  }
})

/**
 * The registry half of the token path: verify the bearer token against the
 * registry and hand back its principal facts (id, workspace, scopes). Whether
 * those scopes cover what was asked is a separate `requirePermission` call —
 * see `enforcePermission`.
 */
export const verifyToken = Effect.fn('Api.verifyToken')(function* (
  token: string | null
): Effect.fn.Return<
  ApiPrincipalValue,
  Unauthorized | CapabilityUnavailable,
  ApiTokenRegistry | Scope.Scope
> {
  if (!token) {
    yield* annotateWideEvent({ outcome: 'missing_bearer_token' })
    return yield* Effect.fail(new Unauthorized({ message: 'missing_bearer_token' }))
  }

  const registry = yield* ApiTokenRegistry
  const verified = yield* Effect.result(registry.verifyBearerToken(token))
  if (Result.isFailure(verified)) {
    const failure = verified.failure
    if (failure._tag === 'CapabilityUnavailable') {
      yield* annotateWideEvent({
        outcome: 'capability_unavailable',
        capability: failure.capability,
        capabilityReason: failure.reason
      })
      return yield* Effect.fail(failure)
    }
    // Verification only ever fails for an unknown or revoked token, which is
    // an authentication failure: 401, not 403.
    yield* annotateWideEvent({
      outcome: 'unauthorized',
      authReason: failure.reason
    })
    return yield* Effect.fail(new Unauthorized({ message: failure.reason }))
  }

  yield* annotateWideEvent({
    tokenId: verified.success.id,
    workspaceId: verified.success.workspaceId,
    tokenScopes: verified.success.scopes
  })

  return verified.success
})

/**
 * Authorization over the already-authenticated principal: the token must belong
 * to `expectedWorkspaceSlug` (when given) and its scopes must satisfy the named
 * permission. Endpoints name a *permission* (`{ apiToken: ['create'] }`), not a
 * token scope — the scope-to-permission mapping lives in
 * `@b2b-saas-starter/authz`, so a session in the web app and a bearer token
 * here reach the same decision.
 *
 * Authentication is the `BearerAuth` middleware's job (see {@link bearerAuth});
 * this reads the `ApiPrincipal` it provided.
 */
export const enforcePermission = Effect.fn('Api.enforcePermission')(function* (
  permission: PermissionRequest,
  expectedWorkspaceSlug?: string
): Effect.fn.Return<
  void,
  AuthorizationDenied | WorkspaceSuspended | CapabilityUnavailable,
  ApiPrincipal | WorkspaceSuspensionService | Scope.Scope
> {
  const verified = yield* ApiPrincipal

  if (
    expectedWorkspaceSlug !== undefined &&
    verified.workspaceSlug !== expectedWorkspaceSlug
  ) {
    yield* annotateWideEvent({
      outcome: 'forbidden',
      authReason: 'token_workspace_mismatch'
    })
    return yield* Effect.fail(
      new AuthorizationDenied({
        reason: AUTHORIZATION_DENIED_REASONS.tokenWorkspaceMismatch
      })
    )
  }

  yield* requirePermission(tokenPrincipal(verified.scopes), permission)
  const suspension = yield* WorkspaceSuspensionService
  yield* suspension.requireAllowed(
    verified.workspaceId,
    workspaceSuspensionOperationForPermission(permission)
  )
})

/** Preserve the failure's safe facts before the HTTP contract translates it. */
export function annotateRequestFailure(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- generic Effect error boundary; the logger keeps only its sanitized facts
  error: unknown
): Effect.Effect<void> {
  return annotateWideEventCause(Cause.fail(error))
}

export function observed<A, E, R>(
  event: string,
  body: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> {
  return Effect.andThen(
    annotateWideEvent({ operation: `request.${event}` }),
    body.pipe(Effect.tapError(annotateRequestFailure))
  )
}

/**
 * The Worker's own `Request` behind the router's request. `toWebResult` hands
 * the source straight back when it already is one — which it is for every
 * request this worker serves, since `HttpRouter.toWebHandler` is fed the
 * platform's `Request` (the same conversion the MCP gate uses). That is what lets
 * the envelope read `request.cf.colo` and stamp the colo onto the wide event.
 *
 * It fails only for a source with no derivable URL, which this worker never
 * serves.
 */
export function webRequest(request: HttpServerRequest.HttpServerRequest): Request {
  return Result.getOrThrow(HttpServerRequest.toWebResult(request))
}

/**
 * Resolves the request's workspace and provides it to `body`. REST and MCP
 * operation guards enforce suspension after proving caller authority.
 *
 * Only `WorkspaceContext` is built here. Every other capability service is
 * request-independent and lives on the isolate-level layer `http.ts` hands to
 * `HttpRouter.provideRequest`, so a request pays for the workspace lookup and
 * nothing else.
 *
 * `caller` names who made the request — the audit writes a mutating
 * capability performs label their rows with it. The REST groups are
 * bearer-token-only, so they pass `WorkspaceCaller.apiToken`; MCP callers take
 * theirs from their caller-kind policy (`provideMcpWorkspace`).
 */
export function provideWorkspace<A, E, R>(
  env: ApiEnv,
  slug: string,
  body: Effect.Effect<A, E, R>,
  caller: WorkspaceCaller
) {
  return body.pipe(
    Effect.provide(selectWorkspaceContextLayer(starterEnv(env), slug, caller))
  )
}

/**
 * The contract's bearer gate, as an `HttpApiMiddleware` implementation.
 *
 * Every group except `health` carries `BearerAuth` (see `packages/api`), so the
 * gate is declared once on the contract instead of hand-composed in each
 * handler: the credential is decoded by `HttpApiSecurity.bearer` — which is
 * also what puts `securitySchemes` in the served OpenAPI document — the group's
 * rate-limit bucket is drawn, the token is verified, and the handler runs with
 * an `ApiPrincipal` in context. Handlers add only `enforcePermission`.
 *
 * Gate facts accumulate in the outer HTTP invocation, including rejections.
 */
export function bearerAuth(): Layer.Layer<BearerAuth> {
  return Layer.succeed(BearerAuth)(
    BearerAuth.of({
      // oxlint-disable-next-line starter/named-service-operation -- HttpApiMiddleware, not a service operation: it runs the handler effect it receives, so a span here would enclose the whole request
      bearer: (httpEffect, { credential, endpoint, group }) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
          yield* annotateWideEvent({
            operation: `request.${group.identifier}.${endpoint.identifier}`
          })
          const bucket = rateLimitBucketFor(group.identifier)
          if (bucket === undefined) {
            // A gated group with no bucket row is a wiring mistake, and the
            // honest answer is that this worker cannot rate limit the call —
            // fail closed with the contract's 503 rather than serve it
            // unlimited. `permission-matrix.test.ts` asserts the contract's
            // table covers every group carrying this middleware, so the row is
            // missing only while someone is mid-change.
            return yield* Effect.fail(
              new CapabilityUnavailable({
                capability: 'rate-limit',
                reason: `no bucket declared for group ${group.identifier}`
              })
            )
          }

          const gate = Effect.gen(function* () {
            yield* enforceRateLimit(request, bucket)
            return yield* verifyToken(Redacted.value(credential) || null)
          }).pipe(Effect.tapError(annotateRequestFailure))

          const principal = yield* gate
          return yield* Effect.provideService(httpEffect, ApiPrincipal, principal)
        })
    })
  )
}
