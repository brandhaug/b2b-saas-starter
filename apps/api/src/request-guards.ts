import { withHttpInvocation } from '@b2b-saas-starter/logger'
import { requirePermission } from '@b2b-saas-starter/authz/guard'
import { tokenPrincipal, type PermissionRequest } from '@b2b-saas-starter/authz/client'
import { ApiTokenRegistry } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import { selectWorkspaceContextLayer } from '@b2b-saas-starter/capabilities/runtime'
import { AuthorizationDenied } from '@b2b-saas-starter/authz/errors'
import { Effect, Layer, Redacted, Result, type Scope } from 'effect'
import { HttpServerRequest } from 'effect/unstable/http'

import {
  ApiPrincipal,
  BearerAuth,
  rateLimitBucketFor,
  RateLimited,
  Unauthorized,
  type ApiPrincipalValue
} from '@b2b-saas-starter/api'
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
  if (!header?.startsWith('Bearer ')) {
    return null
  }
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
      yield* Effect.annotateLogsScoped({
        outcome: 'rate_limited',
        rateLimitBucket: bucket
      })
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
  ApiPrincipalValue,
  Unauthorized | CapabilityUnavailable,
  ApiTokenRegistry | Scope.Scope
> {
  return verifyToken(bearerToken(request))
}

/**
 * The registry half of {@link authenticate}, over an already-extracted token:
 * the contract's `BearerAuth` middleware is handed a decoded credential by
 * `HttpApiSecurity.bearer`, the MCP protocol route reads the header itself, and
 * both land here so there is one verification path.
 */
export function verifyToken(
  token: string | null
): Effect.Effect<
  ApiPrincipalValue,
  Unauthorized | CapabilityUnavailable,
  ApiTokenRegistry | Scope.Scope
> {
  return Effect.gen(function* () {
    if (!token) {
      yield* Effect.annotateLogsScoped({ outcome: 'missing_bearer_token' })
      return yield* Effect.fail(new Unauthorized({ message: 'missing_bearer_token' }))
    }

    const registry = yield* ApiTokenRegistry
    const verified = yield* Effect.result(registry.verifyBearerToken(token))
    if (Result.isFailure(verified)) {
      const failure = verified.failure
      if (failure._tag === 'CapabilityUnavailable') {
        yield* Effect.annotateLogsScoped({
          outcome: 'capability_unavailable',
          capability: failure.capability,
          capabilityReason: failure.reason
        })
        return yield* Effect.fail(failure)
      }
      // Verification only ever fails for an unknown or revoked token, which is
      // an authentication failure: 401, not 403.
      yield* Effect.annotateLogsScoped({
        outcome: 'unauthorized',
        authReason: failure.reason
      })
      return yield* Effect.fail(new Unauthorized({ message: failure.reason }))
    }

    yield* Effect.annotateLogsScoped({
      tokenId: verified.success.id,
      workspaceId: verified.success.workspaceId,
      tokenWorkspaceSlug: verified.success.workspaceSlug,
      tokenScopes: verified.success.scopes
    })

    return verified.success
  })
}

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
export function enforcePermission(
  permission: PermissionRequest,
  expectedWorkspaceSlug?: string
): Effect.Effect<void, AuthorizationDenied, ApiPrincipal | Scope.Scope> {
  return Effect.gen(function* () {
    const verified = yield* ApiPrincipal

    if (
      expectedWorkspaceSlug !== undefined &&
      verified.workspaceSlug !== expectedWorkspaceSlug
    ) {
      yield* Effect.annotateLogsScoped({
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
  return withHttpInvocation(
    {
      service: 'api',
      event: `request.${event}`,
      request: webRequest(request),
      env,
      metadata
    },
    body.pipe(Effect.tap(() => Effect.annotateLogsScoped({ outcome: 'ok' })))
  )
}

/**
 * The Worker's own `Request` behind the router's request. `toWebResult` hands
 * the source straight back when it already is one — which it is for every
 * request this worker serves, since `HttpRouter.toWebHandler` is fed the
 * platform's `Request` (the same conversion `mcp.ts` uses). That is what lets
 * the envelope read `request.cf.colo` and stamp the colo onto the wide event.
 *
 * It fails only for a source with no derivable URL. Such a request carries no
 * `cf` object either, so the fallback rebuilds exactly the two things the
 * envelope still reads — the URL and the headers — against a synthetic origin.
 */
function webRequest(request: HttpServerRequest.HttpServerRequest): Request {
  const web = HttpServerRequest.toWebResult(request)
  if (Result.isSuccess(web)) {
    return web.success
  }
  return new Request(new URL(request.url, 'http://request.invalid'), {
    method: request.method,
    headers: { ...request.headers }
  })
}

/**
 * Resolves the request's workspace and provides it to `body`.
 *
 * Only `WorkspaceContext` is built here. Every other capability service is
 * request-independent and lives on the isolate-level layer `http.ts` hands to
 * `HttpRouter.provideRequest`, so a request pays for the workspace lookup and
 * nothing else.
 */
export function provideWorkspace<A, E, R>(
  env: ApiEnv,
  slug: string,
  body: Effect.Effect<A, E, R>
) {
  return body.pipe(Effect.provide(selectWorkspaceContextLayer(starterEnv(env), slug)))
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
 * The gate runs before the handler body, so a rejected request never reaches
 * the handler's `observed(...)` envelope. It emits its own wide event here
 * instead, carrying the annotations the guards set on the request scope.
 */
export function bearerAuth(env: ApiEnv): Layer.Layer<BearerAuth> {
  return Layer.succeed(BearerAuth)(
    BearerAuth.of({
      bearer: (httpEffect, { credential, endpoint, group }) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest
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
          }).pipe(
            Effect.catch((error) =>
              observed(
                env,
                request,
                `${group.identifier}.${endpoint.identifier}`,
                {},
                Effect.fail(error)
              )
            )
          )

          const principal = yield* gate
          return yield* Effect.provideService(httpEffect, ApiPrincipal, principal)
        })
    })
  )
}
