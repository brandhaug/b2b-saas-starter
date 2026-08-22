import { Effect, Result, type Scope } from 'effect'
import { type HttpServerRequest } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { AssistantService, isAssistantConfigured } from '@b2b-saas-starter/ai'
import { RateLimited, StarterApi, Unauthorized } from '@b2b-saas-starter/api'
import {
  requirePermission,
  tokenPrincipal,
  type PermissionRequest
} from '@b2b-saas-starter/authz'
import {
  ApiTokenRegistry,
  type ApiToken,
  AuditEventLog,
  AuthorizationDenied,
  type CapabilityUnavailable,
  NotificationFeed,
  selectWorkspaceLayer,
  type WebhookEndpoint,
  WebhookEndpoints,
  WebhookPublisher,
  workspaceOverview,
  type WorkspaceContext,
  WorkspaceMembership
} from '@b2b-saas-starter/capabilities'
import {
  annotateWide,
  makeOtlpLayer,
  parentSpanFromHeaders,
  readWideEventEnvironment,
  TRACE_HEADER,
  withRequestScope
} from '@b2b-saas-starter/logger'
import { providerEnv, starterEnv, type ApiEnv } from './env.ts'
import { RateLimiter, type RateLimitBucket } from './rate-limit.ts'

/**
 * Contract response literals. Each is declared with the literal type the
 * `StarterApi` success schema pins down, so the value is *checked* against the
 * contract instead of asserted with `as const`.
 */
const HEALTH_OK = { status: 'ok' } satisfies { readonly status: 'ok' }
const TOKEN_REVOKED = { status: 'revoked' } satisfies { readonly status: 'revoked' }

function clientKey(request: HttpServerRequest.HttpServerRequest): string {
  return request.headers['cf-connecting-ip'] ?? `unkeyed:${request.url}`
}

function bearerToken(request: HttpServerRequest.HttpServerRequest): string | null {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) return null
  return header.slice('Bearer '.length).trim()
}

function enforceRateLimit(
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
 * The worker's enforcement point: authenticate the bearer token, confine it to
 * its own workspace, then ask the one `authorize()` path whether it may do what
 * it asked. Endpoints name a *permission* (`{ apiToken: ['create'] }`), not a
 * token scope — the scope-to-permission mapping lives in `@b2b-saas-starter/authz`,
 * so a session in the web app and a bearer token here reach the same decision.
 */
function enforcePermission(
  request: HttpServerRequest.HttpServerRequest,
  permission: PermissionRequest,
  expectedWorkspaceSlug?: string
): Effect.Effect<
  void,
  Unauthorized | AuthorizationDenied | CapabilityUnavailable,
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

    if (
      expectedWorkspaceSlug !== undefined &&
      verified.success.workspaceSlug !== expectedWorkspaceSlug
    ) {
      yield* annotateWide({
        outcome: 'forbidden',
        authReason: 'token_workspace_mismatch',
        tokenWorkspaceSlug: verified.success.workspaceSlug
      })
      return yield* Effect.fail(
        new AuthorizationDenied({ reason: 'token_workspace_mismatch' })
      )
    }

    yield* annotateWide({
      tokenId: verified.success.id,
      workspaceId: verified.success.workspaceId,
      tokenWorkspaceSlug: verified.success.workspaceSlug,
      tokenScopes: verified.success.scopes
    })

    yield* requirePermission(tokenPrincipal(verified.success.scopes), permission)
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

function observed<A, E, R>(
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

function provideWorkspace<A, E, R>(
  env: ApiEnv,
  slug: string,
  body: Effect.Effect<A, E, R>
) {
  return body.pipe(Effect.provide(selectWorkspaceLayer(starterEnv(env), slug)))
}

/**
 * The webhook events this worker publishes, paired with the payload shape each
 * one carries. The queue wire schema types `payload` as unknown because it is
 * event-specific; this union is where the shapes actually published from here
 * are pinned down, so a handler cannot enqueue an unintended body.
 */
type PublishedWebhookEvent =
  | {
      readonly eventType: 'api_token.created'
      readonly payload: Omit<ApiToken, 'lastUsedAt'>
    }
  | {
      readonly eventType: 'api_token.revoked'
      readonly payload: { readonly tokenId: string }
    }
  | {
      readonly eventType: 'webhook_endpoint.created'
      readonly payload: WebhookEndpoint
    }

function publishWebhookEvent(
  event: PublishedWebhookEvent
): Effect.Effect<void, never, WebhookPublisher | WorkspaceContext | Scope.Scope> {
  return Effect.gen(function* () {
    const publisher = yield* WebhookPublisher
    const published = yield* Effect.result(publisher.publish(event))
    if (Result.isFailure(published)) {
      yield* annotateWide({
        webhookPublish: 'failed',
        webhookPublishReason: published.failure.reason
      })
    }
  })
}

export function healthGroup(env: ApiEnv) {
  return HttpApiBuilder.group(StarterApi, 'health', (handlers) =>
    handlers.handle('check', ({ request }) =>
      observed(env, request, 'health', {}, Effect.succeed(HEALTH_OK))
    )
  )
}

export function workspaceGroup(env: ApiEnv) {
  return HttpApiBuilder.group(StarterApi, 'workspace', (handlers) => {
    function read<A, E, R>(
      event: string,
      permission: PermissionRequest,
      slug: string,
      request: HttpServerRequest.HttpServerRequest,
      body: Effect.Effect<A, E, R>
    ) {
      return observed(
        env,
        request,
        `workspace.${event}`,
        { workspaceSlug: slug },
        Effect.gen(function* () {
          yield* enforceRateLimit(request, 'rest_read')
          yield* enforcePermission(request, permission, slug)
          return yield* provideWorkspace(env, slug, body)
        })
      )
    }

    return (
      handlers
        .handle('overview', ({ params, request }) =>
          read(
            'overview',
            { notification: ['read'] },
            params.slug,
            request,
            workspaceOverview
          )
        )
        // Listing members exposes who holds which role, which is what `ac:read`
        // names. The plugin's `member` statement covers mutations only — it has
        // no `read` action.
        .handle('members', ({ params, request }) =>
          read(
            'members',
            { ac: ['read'] },
            params.slug,
            request,
            Effect.flatMap(WorkspaceMembership, (membership) => membership.listMembers)
          )
        )
        .handle('notifications', ({ params, request }) =>
          read(
            'notifications',
            { notification: ['read'] },
            params.slug,
            request,
            Effect.flatMap(NotificationFeed, (feed) => feed.list)
          )
        )
        .handle('api-tokens', ({ params, request }) =>
          read(
            'api-tokens',
            { apiToken: ['list'] },
            params.slug,
            request,
            Effect.flatMap(ApiTokenRegistry, (tokens) => tokens.list)
          )
        )
        .handle('webhooks', ({ params, request }) =>
          read(
            'webhooks',
            { webhook: ['list'] },
            params.slug,
            request,
            Effect.flatMap(WebhookEndpoints, (webhooks) => webhooks.list)
          )
        )
        .handle('audit-events', ({ params, request }) =>
          read(
            'audit-events',
            { auditLog: ['read'] },
            params.slug,
            request,
            Effect.flatMap(AuditEventLog, (log) => log.list)
          )
        )
    )
  })
}

export function apiTokenGroup(env: ApiEnv) {
  return HttpApiBuilder.group(StarterApi, 'api-token-registry', (handlers) =>
    handlers
      .handle('create', ({ params, payload, request }) =>
        observed(
          env,
          request,
          'api-tokens.create',
          { workspaceSlug: params.slug },
          Effect.gen(function* () {
            yield* enforceRateLimit(request, 'rest_write')
            yield* enforcePermission(request, { apiToken: ['create'] }, params.slug)
            const created = yield* provideWorkspace(
              env,
              params.slug,
              Effect.gen(function* () {
                const tokens = yield* ApiTokenRegistry
                const next = yield* tokens.create({
                  name: payload.name,
                  scopes: payload.scopes
                })
                yield* publishWebhookEvent({
                  eventType: 'api_token.created',
                  payload: {
                    id: next.id,
                    name: next.name,
                    prefix: next.prefix,
                    scopes: next.scopes,
                    createdAt: next.createdAt
                  }
                })
                return next
              })
            )
            yield* annotateWide({ tokenId: created.id, tokenScopes: created.scopes })
            return created
          })
        )
      )
      .handle('revoke', ({ params, request }) =>
        observed(
          env,
          request,
          'api-tokens.revoke',
          { workspaceSlug: params.slug },
          Effect.gen(function* () {
            yield* enforceRateLimit(request, 'rest_write')
            yield* enforcePermission(request, { apiToken: ['revoke'] }, params.slug)
            yield* provideWorkspace(
              env,
              params.slug,
              Effect.gen(function* () {
                const tokens = yield* ApiTokenRegistry
                const revoked = yield* tokens.revoke({ tokenId: params.tokenId })
                if (revoked) {
                  yield* publishWebhookEvent({
                    eventType: 'api_token.revoked',
                    payload: { tokenId: params.tokenId }
                  })
                }
              })
            )
            return TOKEN_REVOKED
          })
        )
      )
      .handle('delete', ({ params, request }) =>
        observed(
          env,
          request,
          'api-tokens.delete',
          { workspaceSlug: params.slug },
          Effect.gen(function* () {
            yield* enforceRateLimit(request, 'rest_write')
            yield* enforcePermission(request, { apiToken: ['revoke'] }, params.slug)
            yield* provideWorkspace(
              env,
              params.slug,
              Effect.gen(function* () {
                const tokens = yield* ApiTokenRegistry
                const revoked = yield* tokens.revoke({ tokenId: params.tokenId })
                if (revoked) {
                  yield* publishWebhookEvent({
                    eventType: 'api_token.revoked',
                    payload: { tokenId: params.tokenId }
                  })
                }
              })
            )
            return TOKEN_REVOKED
          })
        )
      )
  )
}

export function webhookGroup(env: ApiEnv) {
  return HttpApiBuilder.group(StarterApi, 'webhook-endpoints', (handlers) =>
    handlers.handle('create', ({ params, payload, request }) =>
      observed(
        env,
        request,
        'webhooks.create',
        { workspaceSlug: params.slug },
        Effect.gen(function* () {
          yield* enforceRateLimit(request, 'rest_write')
          yield* enforcePermission(request, { webhook: ['create'] }, params.slug)
          const created = yield* provideWorkspace(
            env,
            params.slug,
            Effect.gen(function* () {
              const webhooks = yield* WebhookEndpoints
              const endpoint = yield* webhooks.create({
                url: payload.url,
                events: payload.events,
                description: payload.description
              })
              yield* publishWebhookEvent({
                eventType: 'webhook_endpoint.created',
                payload: endpoint
              })
              return endpoint
            })
          )
          yield* annotateWide({ webhookEndpointId: created.id })
          return created
        })
      )
    )
  )
}

export function assistantGroup(env: ApiEnv) {
  return HttpApiBuilder.group(StarterApi, 'assistant', (handlers) =>
    handlers.handle('answer', ({ payload, request }) =>
      observed(
        env,
        request,
        'assistant.answer',
        {},
        Effect.gen(function* () {
          yield* enforceRateLimit(request, 'assistant')
          yield* enforcePermission(request, { notification: ['read'] })
          const service = yield* AssistantService
          const reply = yield* service.ask(payload)
          return {
            answer: reply.answer,
            provider: reply.provider,
            modelId: reply.modelId,
            usedTools: reply.usedTools,
            assistantConfigured: isAssistantConfigured(providerEnv(env))
          }
        })
      )
    )
  )
}

export function mcpGroup(env: ApiEnv) {
  return HttpApiBuilder.group(StarterApi, 'mcp', (handlers) =>
    handlers.handle('discover', ({ request }) =>
      observed(
        env,
        request,
        'mcp.discover',
        {},
        Effect.gen(function* () {
          yield* enforceRateLimit(request, 'mcp')
          yield* enforcePermission(request, { notification: ['read'] })
          return {
            name: 'b2b-saas-starter-mcp',
            resources: ['workspace://starter-lab/overview'],
            tools: []
          }
        })
      )
    )
  )
}
