import {
  annotateWide,
  makeOtlpLayer,
  parentSpanFromHeaders,
  readWideEventEnvironment,
  TRACE_HEADER,
  withRequestScope
} from '@b2b-saas-starter/logger'
import { requirePermission } from '@b2b-saas-starter/authz/src/guard.ts'
import {
  tokenPrincipal,
  type PermissionRequest
} from '@b2b-saas-starter/authz/src/client.ts'
import { type ApiTokenScope } from '@b2b-saas-starter/authz/src/roles.ts'
import { ApiTokenRegistry } from '@b2b-saas-starter/capabilities/src/developer-platform/api-token-registry.ts'
import { type CapabilityUnavailable } from '@b2b-saas-starter/capabilities/src/errors.ts'
import { selectWorkspaceLayer } from '@b2b-saas-starter/capabilities/src/runtime.ts'
import { AuthorizationDenied } from '@b2b-saas-starter/authz/src/errors.ts'
import { Effect, Result, type Scope } from 'effect'
import { type HttpServerRequest } from 'effect/unstable/http'

import { RateLimited, Unauthorized } from '@b2b-saas-starter/api'
import { starterEnv, type ApiEnv } from './env.ts'
import { RateLimiter, type RateLimitBucket } from './rate-limit.ts'

/**
 * The per-request enforcement helpers shared by every served surface — the
 * `StarterApi` contract groups in `handlers.ts` *and* the raw MCP protocol
 * route in `mcp.ts`. One authenticate path, one rate-limit path, one wide-event
 * envelope: a new surface cannot grow a second, weaker gate.
 */

export function clientKey(request: HttpServerRequest.HttpServerRequest): string {
  return request.headers['cf-connecting-ip'] ?? `unkeyed:${request.url}`
}

export function bearerToken(
  request: HttpServerRequest.HttpServerRequest
): string | null {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) return null
  return header.slice('Bearer '.length).trim()
}

export function enforceRateLimit(
  request: HttpServerRequest.HttpServerRequest,
  bucket: RateLimitBucket
): Effect.Effect<void, RateLimited, RateLimiter | Scope.Scope> {
  return Effect.gen(function* () {
    const limiter = yield* RateLimiter
    const allowed = yield* limiter.take({ bucket, key: clientKey(request) })
    if (!allowed) {
      yield* annotateWide({ outcome: 'rate_limited', rateLimitBucket: bucket })
      return yield* Effect.fail(new RateLimited({ bucket }))
    }
  })
}

/**
 * The worker's authentication half: verify the bearer token against the
 * registry and hand back its principal facts (id, workspace, scopes). Whether
 * those scopes cover what was asked is a separate `requirePermission` call —
 * see `enforcePermission`.
 */
export function authenticate(
  request: HttpServerRequest.HttpServerRequest
): Effect.Effect<
  {
    readonly id: string
    readonly workspaceId: string
    readonly workspaceSlug: string
    readonly scopes: readonly ApiTokenScope[]
  },
  Unauthorized | CapabilityUnavailable,
  ApiTokenRegistry | Scope.Scope
> {
  return Effect.gen(function* () {
    const token = bearerToken(request)
    if (!token) {
      yield* annotateWide({ outcome: 'missing_bearer_token' })
      return yield* Effect.fail(new Unauthorized({ message: 'missing_bearer_token' }))
    }

    const registry = yield* ApiTokenRegistry
    const verified = yield* Effect.result(registry.verifyBearerToken(token))
    if (Result.isFailure(verified)) {
      const failure = verified.failure
      if (failure._tag === 'CapabilityUnavailable') {
        yield* annotateWide({
          outcome: 'capability_unavailable',
          capability: failure.capability,
          capabilityReason: failure.reason
        })
        return yield* Effect.fail(failure)
      }
      // Verification only ever fails for an unknown or revoked token, which is
      // an authentication failure: 401, not 403.
      yield* annotateWide({ outcome: 'unauthorized', authReason: failure.reason })
      return yield* Effect.fail(new Unauthorized({ message: failure.reason }))
    }

    yield* annotateWide({
      tokenId: verified.success.id,
      workspaceId: verified.success.workspaceId,
      tokenWorkspaceSlug: verified.success.workspaceSlug,
      tokenScopes: verified.success.scopes
    })

    return verified.success
  })
}

/**
 * Authentication plus authorization in one step: the verified token must
 * belong to `expectedWorkspaceSlug` (when given) and its scopes must satisfy
 * the named permission. Endpoints name a *permission*
 * (`{ apiToken: ['create'] }`), not a token scope — the scope-to-permission
 * mapping lives in `@b2b-saas-starter/authz`, so a session in the web app and
 * a bearer token here reach the same decision.
 */
export function enforcePermission(
  request: HttpServerRequest.HttpServerRequest,
  permission: PermissionRequest,
  expectedWorkspaceSlug?: string
): Effect.Effect<
  void,
  Unauthorized | AuthorizationDenied | CapabilityUnavailable,
  ApiTokenRegistry | Scope.Scope
> {
  return Effect.gen(function* () {
    const verified = yield* authenticate(request)

    if (
      expectedWorkspaceSlug !== undefined &&
      verified.workspaceSlug !== expectedWorkspaceSlug
    ) {
      yield* annotateWide({
        outcome: 'forbidden',
        authReason: 'token_workspace_mismatch',
        tokenWorkspaceSlug: verified.workspaceSlug
      })
      return yield* Effect.fail(
        new AuthorizationDenied({ reason: 'token_workspace_mismatch' })
      )
    }

    yield* requirePermission(tokenPrincipal(verified.scopes), permission)
  })
}

/**
 * Extra wide-event fields a handler contributes on top of the envelope's
 * `pathname`/`method`. Workspace routes name the slug they resolved; the
 * account-wide routes have nothing to add.
 */
type RequestMetadata = {
  readonly workspaceSlug?: string
}

export function observed<A, E, R>(
  env: ApiEnv,
  request: HttpServerRequest.HttpServerRequest,
  event: string,
  metadata: RequestMetadata,
  body: Effect.Effect<A, E, R>
): Effect.Effect<A, E, Exclude<R, Scope.Scope>> {
  return withRequestScope(
    {
      service: 'api',
      event: `request.${event}`,
      traceId: request.headers[TRACE_HEADER],
      parent: parentSpanFromHeaders(request.headers),
      spanKind: 'server',
      environment: readWideEventEnvironment(env),
      metadata: { pathname: request.url, method: request.method, ...metadata }
    },
    body.pipe(Effect.tap(() => annotateWide({ outcome: 'ok' })))
    // `local: true` forces a fresh build per request: the OTLP exporters must
    // live and die inside one invocation (see `makeOtlpLayer`), and a shared
    // memo map would hand every later request the first request's exporters.
  ).pipe(Effect.provide(makeOtlpLayer('api', env), { local: true }))
}

export function provideWorkspace<A, E, R>(
  env: ApiEnv,
  slug: string,
  body: Effect.Effect<A, E, R>
) {
  return body.pipe(Effect.provide(selectWorkspaceLayer(starterEnv(env), slug)))
}
