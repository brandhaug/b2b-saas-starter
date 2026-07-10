import { Effect, Result, type Scope } from 'effect'
import type { HttpServerRequest } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import {
  PlatformInsufficientScope,
  PlatformInvalidCursor,
  PlatformInvalidRequest,
  PlatformResourceNotFound,
  PlatformScopeEscalationDenied,
  PlatformUnauthorized,
  RateLimited,
  StarterApi
} from '@b2b-saas-starter/api'
import {
  type CapabilityUnavailable,
  PlatformApiReads,
  PlatformApiTokenRegistry,
  type PlatformApiTokenScope,
  PlatformWebhookEndpoints,
  type VerifiedPlatformApiToken
} from '@b2b-saas-starter/capabilities'
import {
  annotateWide,
  newTraceId,
  readWideEventEnvironment,
  TRACE_HEADER,
  withRequestScope
} from '@b2b-saas-starter/logger'
import type { ApiEnv } from './env.ts'
import { RateLimiter, type RateLimitBucket } from './rate-limit.ts'

const bearerToken = (request: HttpServerRequest.HttpServerRequest) => {
  const header = request.headers.authorization
  return header?.startsWith('Bearer ') ? header.slice(7).trim() : null
}
const clientKey = (request: HttpServerRequest.HttpServerRequest) =>
  request.headers['cf-connecting-ip'] ?? 'unkeyed'
const errorBody = (
  code:
    | 'unauthorized'
    | 'insufficient_scope'
    | 'invalid_cursor'
    | 'invalid_request'
    | 'resource_not_found'
    | 'scope_escalation_denied',
  request: HttpServerRequest.HttpServerRequest,
  details: Record<string, unknown> = {}
) => ({
  error: {
    code,
    message:
      code === 'unauthorized'
        ? 'Authentication is required.'
        : code === 'insufficient_scope'
          ? 'The credential lacks the required scope.'
          : code === 'invalid_cursor'
            ? 'The cursor is invalid.'
            : code === 'resource_not_found'
              ? 'The resource was not found.'
              : code === 'scope_escalation_denied'
                ? 'A credential cannot delegate scopes it does not hold.'
                : 'The request is invalid.',
    traceId: request.headers[TRACE_HEADER] ?? newTraceId(),
    details
  }
})
const limit = (
  request: HttpServerRequest.HttpServerRequest,
  bucket: RateLimitBucket,
  key: string
) =>
  Effect.gen(function* () {
    const limiter = yield* RateLimiter
    if (!(yield* limiter.take({ bucket, key })))
      return yield* Effect.fail(new RateLimited({ bucket }))
  })
const verify = (
  request: HttpServerRequest.HttpServerRequest,
  scope: PlatformApiTokenScope
): Effect.Effect<
  VerifiedPlatformApiToken,
  | PlatformUnauthorized
  | PlatformInsufficientScope
  | RateLimited
  | CapabilityUnavailable,
  PlatformApiTokenRegistry | RateLimiter | Scope.Scope
> =>
  Effect.gen(function* () {
    const credential = bearerToken(request)
    if (!credential) {
      yield* limit(request, 'auth_failure', clientKey(request))
      return yield* Effect.fail(
        new PlatformUnauthorized(errorBody('unauthorized', request))
      )
    }
    const registry = yield* PlatformApiTokenRegistry
    const result = yield* Effect.result(registry.verify(credential, scope))
    if (Result.isSuccess(result)) return result.success
    if (result.failure._tag === 'CapabilityUnavailable')
      return yield* Effect.fail(result.failure)
    if (result.failure.reason === 'insufficient_scope')
      return yield* Effect.fail(
        new PlatformInsufficientScope(
          errorBody('insufficient_scope', request, { requiredScope: scope })
        )
      )
    yield* limit(request, 'auth_failure', clientKey(request))
    return yield* Effect.fail(
      new PlatformUnauthorized(errorBody('unauthorized', request))
    )
  })
const observed = <A, E, R>(
  env: ApiEnv,
  request: HttpServerRequest.HttpServerRequest,
  event: string,
  body: Effect.Effect<A, E, R>
): Effect.Effect<A, E, Exclude<R, Scope.Scope>> =>
  withRequestScope(
    {
      service: 'api',
      event: `request.${event}`,
      traceId: request.headers[TRACE_HEADER],
      environment: readWideEventEnvironment(env),
      metadata: { pathname: request.url, method: request.method }
    },
    body.pipe(Effect.tap(() => annotateWide({ outcome: 'ok' })))
  )
const read = <A, E, R>(
  env: ApiEnv,
  request: HttpServerRequest.HttpServerRequest,
  event: string,
  scope: PlatformApiTokenScope,
  body: (caller: VerifiedPlatformApiToken) => Effect.Effect<A, E, R>
) =>
  observed(
    env,
    request,
    event,
    Effect.gen(function* () {
      const caller = yield* verify(request, scope)
      yield* limit(request, 'data_read', caller.id)
      return yield* body(caller)
    })
  )
const mapReadError = <A, E extends { _tag: string }, R>(
  request: HttpServerRequest.HttpServerRequest,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<
  A,
  PlatformInvalidCursor | PlatformResourceNotFound | CapabilityUnavailable,
  R
> =>
  Effect.catch(
    effect,
    (
      failure
    ): Effect.Effect<
      never,
      PlatformInvalidCursor | PlatformResourceNotFound | CapabilityUnavailable
    > => {
      if (failure._tag === 'PlatformReadInvalidCursor')
        return Effect.fail(
          new PlatformInvalidCursor(errorBody('invalid_cursor', request))
        )
      if (failure._tag === 'CapabilityUnavailable')
        return Effect.fail(failure as unknown as CapabilityUnavailable)
      return Effect.fail(
        new PlatformResourceNotFound(errorBody('resource_not_found', request))
      )
    }
  )
const validLimit = (
  value: number | undefined,
  request: HttpServerRequest.HttpServerRequest
) =>
  value === undefined || (Number.isSafeInteger(value) && value >= 1 && value <= 100)
    ? Effect.succeed(value)
    : Effect.fail(
        new PlatformInvalidRequest(
          errorBody('invalid_request', request, { limit: 'between_1_and_100' })
        )
      )
const many = <A>(value: A | readonly A[] | undefined): readonly A[] | undefined =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value as A]
const queryInput = (query: Record<string, unknown>) => ({
  ...query,
  status: many(query.status as string | readonly string[] | undefined),
  providerId: many(query.providerId as string | readonly string[] | undefined),
  serviceId: many(query.serviceId as string | readonly string[] | undefined)
})

export const healthGroup = (env: ApiEnv) =>
  HttpApiBuilder.group(StarterApi, 'health', (handlers) =>
    handlers.handle('check', ({ request }) =>
      observed(env, request, 'health', Effect.succeed({ status: 'ok' as const }))
    )
  )
export const merchantGroup = (env: ApiEnv) =>
  HttpApiBuilder.group(StarterApi, 'merchant', (handlers) =>
    handlers.handle('get', ({ request }) =>
      read(env, request, 'merchant.get', 'merchant:read', (caller) =>
        Effect.gen(function* () {
          const api = yield* PlatformApiReads
          return { data: yield* mapReadError(request, api.merchant(caller.merchantId)) }
        })
      )
    )
  )
export const servicesGroup = (env: ApiEnv) =>
  HttpApiBuilder.group(StarterApi, 'services', (handlers) =>
    handlers
      .handle('list', ({ query, request }) =>
        read(env, request, 'services.list', 'services:read', (caller) =>
          Effect.gen(function* () {
            yield* validLimit(query.limit, request)
            const api = yield* PlatformApiReads
            return yield* mapReadError(
              request,
              api.services(caller.merchantId, queryInput(query))
            )
          })
        )
      )
      .handle('get', ({ params, request }) =>
        read(env, request, 'services.get', 'services:read', (caller) =>
          Effect.gen(function* () {
            const api = yield* PlatformApiReads
            return {
              data: yield* mapReadError(
                request,
                api.service(caller.merchantId, params.serviceId)
              )
            }
          })
        )
      )
  )
export const providersGroup = (env: ApiEnv) =>
  HttpApiBuilder.group(StarterApi, 'providers', (handlers) =>
    handlers
      .handle('list', ({ query, request }) =>
        read(env, request, 'providers.list', 'providers:read', (caller) =>
          Effect.gen(function* () {
            yield* validLimit(query.limit, request)
            const api = yield* PlatformApiReads
            return yield* mapReadError(
              request,
              api.providers(caller.merchantId, queryInput(query))
            )
          })
        )
      )
      .handle('get', ({ params, request }) =>
        read(env, request, 'providers.get', 'providers:read', (caller) =>
          Effect.gen(function* () {
            const api = yield* PlatformApiReads
            return {
              data: yield* mapReadError(
                request,
                api.provider(caller.merchantId, params.providerId)
              )
            }
          })
        )
      )
  )
export const appointmentsGroup = (env: ApiEnv) =>
  HttpApiBuilder.group(StarterApi, 'appointments', (handlers) =>
    handlers
      .handle('list', ({ query, request }) =>
        read(env, request, 'appointments.list', 'appointments:read', (caller) =>
          Effect.gen(function* () {
            yield* validLimit(query.limit, request)
            const api = yield* PlatformApiReads
            return yield* mapReadError(
              request,
              api.appointments(caller.merchantId, queryInput(query))
            )
          })
        )
      )
      .handle('get', ({ params, request }) =>
        read(env, request, 'appointments.get', 'appointments:read', (caller) =>
          Effect.gen(function* () {
            const api = yield* PlatformApiReads
            return {
              data: yield* mapReadError(
                request,
                api.appointment(caller.merchantId, params.appointmentId)
              )
            }
          })
        )
      )
  )

export const platformApiTokenGroup = (env: ApiEnv) =>
  HttpApiBuilder.group(StarterApi, 'platform-api-tokens', (handlers) =>
    handlers
      .handle('list', ({ query, request }) =>
        observed(
          env,
          request,
          'tokens.list',
          Effect.gen(function* () {
            const caller = yield* verify(request, 'api_tokens:manage')
            yield* limit(request, 'developer_config', caller.id)
            const api = yield* PlatformApiTokenRegistry
            const result = yield* Effect.result(
              api.list({
                merchantId: caller.merchantId,
                ...(query.status ? { statuses: query.status } : {}),
                ...(query.cursor ? { cursor: query.cursor } : {}),
                ...(query.limit !== undefined ? { limit: query.limit } : {})
              })
            )
            if (Result.isSuccess(result)) return result.success
            return yield* Effect.fail(
              new PlatformInvalidRequest(errorBody('invalid_request', request))
            )
          })
        )
      )
      .handle('create', ({ payload, request }) =>
        observed(
          env,
          request,
          'tokens.create',
          Effect.gen(function* () {
            const caller = yield* verify(request, 'api_tokens:manage')
            yield* limit(request, 'developer_config', caller.id)
            const api = yield* PlatformApiTokenRegistry
            const result = yield* Effect.result(
              api.create({
                merchantId: caller.merchantId,
                ...payload,
                delegatedBy: caller
              })
            )
            if (Result.isSuccess(result)) return result.success
            if (result.failure._tag === 'CapabilityUnavailable')
              return yield* Effect.fail(result.failure)
            return yield* Effect.fail(
              result.failure.reason === 'scope_escalation_denied'
                ? new PlatformScopeEscalationDenied(
                    errorBody('scope_escalation_denied', request)
                  )
                : new PlatformInvalidRequest(errorBody('invalid_request', request))
            )
          })
        )
      )
      .handle('revoke', ({ params, request }) =>
        observed(
          env,
          request,
          'tokens.revoke',
          Effect.gen(function* () {
            const caller = yield* verify(request, 'api_tokens:manage')
            yield* limit(request, 'developer_config', caller.id)
            const api = yield* PlatformApiTokenRegistry
            yield* api.revoke({
              merchantId: caller.merchantId,
              tokenId: params.tokenId,
              actorTokenId: caller.id
            })
          })
        )
      )
  )

export const platformWebhookGroup = (env: ApiEnv) =>
  HttpApiBuilder.group(StarterApi, 'platform-webhooks', (handlers) => {
    const run = <A, E, R>(
      request: HttpServerRequest.HttpServerRequest,
      event: string,
      body: (caller: VerifiedPlatformApiToken) => Effect.Effect<A, E, R>
    ) =>
      observed(
        env,
        request,
        event,
        Effect.gen(function* () {
          const caller = yield* verify(request, 'webhooks:manage')
          yield* limit(request, 'developer_config', caller.id)
          return yield* body(caller)
        })
      )
    const mapped = <A, R>(
      request: HttpServerRequest.HttpServerRequest,
      effect: Effect.Effect<A, { readonly _tag: string }, R>
    ): Effect.Effect<
      A,
      | PlatformInvalidRequest
      | PlatformInvalidCursor
      | PlatformResourceNotFound
      | CapabilityUnavailable,
      R
    > =>
      Effect.catch(
        effect,
        (
          failure
        ): Effect.Effect<
          never,
          | PlatformInvalidRequest
          | PlatformInvalidCursor
          | PlatformResourceNotFound
          | CapabilityUnavailable
        > => {
          if (failure._tag === 'CapabilityUnavailable')
            return Effect.fail(failure as CapabilityUnavailable)
          if (failure._tag === 'PlatformWebhookNotFound')
            return Effect.fail(
              new PlatformResourceNotFound(errorBody('resource_not_found', request))
            )
          if (failure._tag === 'PlatformWebhookInvalidCursor')
            return Effect.fail(
              new PlatformInvalidCursor(errorBody('invalid_cursor', request))
            )
          return Effect.fail(
            new PlatformInvalidRequest(errorBody('invalid_request', request))
          )
        }
      )
    return handlers
      .handle('list', ({ query, request }) =>
        run(request, 'webhooks.list', (caller) =>
          Effect.gen(function* () {
            yield* validLimit(query.limit, request)
            const api = yield* PlatformWebhookEndpoints
            const statuses = query.status ? many(query.status) : undefined
            return yield* mapped(
              request,
              api.list({
                merchantId: caller.merchantId,
                ...(statuses ? { statuses } : {}),
                ...(query.cursor ? { cursor: query.cursor } : {}),
                ...(query.limit ? { limit: query.limit } : {})
              })
            )
          })
        )
      )
      .handle('create', ({ payload, request }) =>
        run(request, 'webhooks.create', (caller) =>
          Effect.gen(function* () {
            const api = yield* PlatformWebhookEndpoints
            return yield* mapped(
              request,
              api.create({
                merchantId: caller.merchantId,
                url: payload.url,
                events: payload.events,
                ...(payload.description !== undefined
                  ? { description: payload.description }
                  : {}),
                actorTokenId: caller.id
              })
            )
          })
        )
      )
      .handle('patch', ({ params, payload, request }) =>
        run(request, 'webhooks.patch', (caller) =>
          Effect.gen(function* () {
            const api = yield* PlatformWebhookEndpoints
            return {
              data: yield* mapped(
                request,
                api.patch({
                  merchantId: caller.merchantId,
                  endpointId: params.endpointId,
                  ...(payload.url !== undefined ? { url: payload.url } : {}),
                  ...(payload.description !== undefined
                    ? { description: payload.description }
                    : {}),
                  ...(payload.events !== undefined ? { events: payload.events } : {}),
                  actorTokenId: caller.id
                })
              )
            }
          })
        )
      )
      .handle('disable', ({ params, request }) =>
        run(request, 'webhooks.disable', (caller) =>
          Effect.gen(function* () {
            const api = yield* PlatformWebhookEndpoints
            yield* api.disable({
              merchantId: caller.merchantId,
              endpointId: params.endpointId,
              actorTokenId: caller.id
            })
          })
        )
      )
      .handle('rotate', ({ params, request }) =>
        run(request, 'webhooks.rotate', (caller) =>
          Effect.gen(function* () {
            const api = yield* PlatformWebhookEndpoints
            return yield* mapped(
              request,
              api.rotateSecret({
                merchantId: caller.merchantId,
                endpointId: params.endpointId,
                actorTokenId: caller.id
              })
            )
          })
        )
      )
      .handle('deliveries', ({ params, query, request }) =>
        run(request, 'webhooks.deliveries', (caller) =>
          Effect.gen(function* () {
            yield* validLimit(query.limit, request)
            const api = yield* PlatformWebhookEndpoints
            const statuses = query.status ? many(query.status) : undefined
            const events = query.event ? many(query.event) : undefined
            return yield* mapped(
              request,
              api.deliveries({
                merchantId: caller.merchantId,
                endpointId: params.endpointId,
                ...(statuses ? { statuses } : {}),
                ...(events ? { events } : {}),
                ...(query.attemptedAtFrom
                  ? { attemptedAtFrom: query.attemptedAtFrom }
                  : {}),
                ...(query.cursor ? { cursor: query.cursor } : {}),
                ...(query.limit ? { limit: query.limit } : {})
              })
            )
          })
        )
      )
  })
