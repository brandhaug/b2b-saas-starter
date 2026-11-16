import { ApiTokenRegistry } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { clientKey } from '@b2b-saas-starter/rate-limit'
import { guardFailureResponse, GuardFailure } from '@b2b-saas-starter/api/errors'
import { RateLimiter } from '@b2b-saas-starter/api'
import { Context, Effect, Schema, Scope, type Types } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http'
import { type ApiEnv } from './env.ts'
import { type McpCaller, verifyMcpCredential } from './mcp-caller.ts'
import {
  OAuthTokenVerifier,
  oauthChallengeHeader,
  oauthResourceConfig
} from './oauth-access-token.ts'
import {
  bearerToken,
  enforceRateLimit,
  observed,
  webRequest
} from './request-guards.ts'

/** Authority and transport facts supplied by the gate for this HTTP request. */
export class CurrentMcpRequest extends Context.Service<
  CurrentMcpRequest,
  {
    readonly caller: McpCaller
    readonly origin: string
    readonly rateKey: string
    readonly bearer: string | null
  }
>()('@b2b-saas-starter/api/mcp/current-request') {}

/**
 * The isolate-level services the credential gate draws on — the same
 * memoized `capabilities` value the REST groups ride on, captured once when
 * the middleware layer builds and provided around each request, so the gate
 * never depends on route middleware ordering.
 */
export type GateServices = RateLimiter | ApiTokenRegistry | OAuthTokenVerifier

/** Route middleware that supplies `CurrentMcpRequest` to the protocol handlers. */
export function mcpCredentialGate(env: ApiEnv) {
  return HttpRouter.middleware<{ provides: CurrentMcpRequest }>()(makeGate(env)).layer
}

/**
 * A guard failure, encoded the way the contract encodes it: the status from
 * the tag→status table in `packages/api` (`errors.test.ts` pins each row to
 * the schema's own `httpApiStatus` annotation, so REST and this surface
 * cannot drift), and the body from the schema's own encoding — so a rejected
 * `/mcp` request answers exactly as a rejected REST route would. Only the
 * JSON-RPC bodies inside the protocol are this surface's own shape.
 */
function failureResponse(
  env: ApiEnv,
  request: HttpServerRequest.HttpServerRequest,
  error: GuardFailure
): HttpServerResponse.HttpServerResponse {
  const { status, body } = guardFailureResponse(error)
  // RFC 9728: a 401 tells an OAuth-capable client where the protected-resource
  // metadata is, which is how Claude finds the authorization server. Only
  // when OAuth is configured — otherwise there is nothing to discover.
  if (error._tag === 'Unauthorized' && oauthResourceConfig(env) !== undefined) {
    const origin = new URL(webRequest(request).url).origin
    return HttpServerResponse.jsonUnsafe(body, {
      status,
      contentType: 'application/problem+json',
      headers: { 'www-authenticate': oauthChallengeHeader(origin) }
    })
  }
  return HttpServerResponse.jsonUnsafe(body, {
    status,
    contentType: 'application/problem+json'
  })
}

const isGuardFailure = Schema.is(GuardFailure)

/**
 * The gate around `layerHttp`'s routes: rate-limit, authenticate (API Token
 * or OAuth access token), then publish the caller and run the protocol
 * handler. `layerHttp` owns the route handlers, so the guards ride as
 * route-scoped router middleware — every protocol request (POST and the
 * method-not-allowed probes alike) draws the `mcp` bucket and answers a
 * rejected credential the way REST does. Guard failures escape the body so
 * `observed` records them like any other rejected request.
 *
 * There is deliberately no permission check beside authentication: every
 * credential the system can mint already clears `mcp:read` (the read and
 * write token scopes carry it, and the OAuth verifier refuses a token without
 * it), so a gate here could never deny. The real enforcement is per tool —
 * each invocation re-checks its own `operation.permission`, the same
 * permission its REST counterpart demands.
 */
function makeGate(
  env: ApiEnv
): Effect.Effect<
  (
    httpEffect: Effect.Effect<
      HttpServerResponse.HttpServerResponse,
      Types.unhandled,
      CurrentMcpRequest
    >
  ) => Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    Types.unhandled,
    HttpServerRequest.HttpServerRequest | Scope.Scope
  >,
  never,
  GateServices
> {
  return Effect.gen(function* () {
    const limiter = yield* RateLimiter
    const registry = yield* ApiTokenRegistry
    const verifier = yield* OAuthTokenVerifier
    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        const requestScope = yield* Scope.Scope
        return yield* Effect.catchIf(
          observed(
            'mcp.protocol',
            Effect.gen(function* () {
              yield* enforceRateLimit(request, 'mcp')
              const bearer = bearerToken(request)
              const caller = yield* verifyMcpCredential(bearer)
              return yield* httpEffect.pipe(
                // The HTTP handler transfers this scope to the response stream.
                // The observation scope closes as soon as the response is returned.
                Effect.provideService(Scope.Scope, requestScope),
                Effect.provideService(CurrentMcpRequest, {
                  caller,
                  origin: new URL(webRequest(request).url).origin,
                  rateKey: clientKey(webRequest(request)),
                  bearer
                })
              )
            })
          ),
          isGuardFailure,
          (failure) => Effect.succeed(failureResponse(env, request, failure))
        )
      }).pipe(
        Effect.provideService(RateLimiter, limiter),
        Effect.provideService(ApiTokenRegistry, registry),
        Effect.provideService(OAuthTokenVerifier, verifier)
      )
  })
}
