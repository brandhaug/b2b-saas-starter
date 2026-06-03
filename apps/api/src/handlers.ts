import { Effect, type Scope, Result } from 'effect'
import type { HttpServerRequest } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { AssistantService, isAssistantConfigured } from '@b2b-saas-starter/ai'
import {
  InternalError,
  RateLimited,
  StarterApi,
  Unauthorized
} from '@b2b-saas-starter/api'
import {
  AdoptionReadiness,
  ApiTokenRegistry,
  type ApiTokenScope,
  AuditEventLog,
  AuthorizationDenied,
  CatalogRefreshHistory,
  ImplementationReports,
  IntegrationSurfaces,
  NotificationFeed,
  projectReadiness,
  selectWorkspaceLayer,
  StarterModuleCatalog,
  WebhookEndpoints,
  WorkspaceContext,
  WorkspaceMembership
} from '@b2b-saas-starter/capabilities'
import { EmailDispatcher, WorkspaceInvitationEmail } from '@b2b-saas-starter/email'
import {
  annotateWide,
  newTraceId,
  readWideEventEnvironment,
  TRACE_HEADER,
  withRequestScope
} from '@b2b-saas-starter/logger'
import type { ApiEnv } from './env.ts'
import { RateLimiter, type RateLimitBucket } from './rate-limit.ts'

// ---------------------------------------------------------------------------
// Request helpers — read from the Effect HttpServerRequest the router decoded.
// ---------------------------------------------------------------------------

const clientKey = (request: HttpServerRequest.HttpServerRequest): string => {
  const ip = request.headers['cf-connecting-ip'] ?? request.headers['x-forwarded-for']
  return ip ?? `unkeyed:${request.url}`
}

const bearerToken = (request: HttpServerRequest.HttpServerRequest): string | null => {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) return null
  return header.slice('Bearer '.length).trim()
}

// ---------------------------------------------------------------------------
// Cross-cutting guards. Each adds only the errors it can raise to the channel,
// so unguarded endpoints (health, mcp) keep a clean error type.
// ---------------------------------------------------------------------------

const enforceRateLimit = (
  request: HttpServerRequest.HttpServerRequest,
  bucket: RateLimitBucket
): Effect.Effect<void, RateLimited, RateLimiter | Scope.Scope> =>
  Effect.gen(function* () {
    const limiter = yield* RateLimiter
    const allowed = yield* limiter.take({ bucket, key: clientKey(request) })
    if (!allowed) {
      yield* annotateWide({ outcome: 'rate_limited', rateLimitBucket: bucket })
      return yield* Effect.fail(new RateLimited({ bucket }))
    }
  })

const enforceScope = (
  request: HttpServerRequest.HttpServerRequest,
  scope: ApiTokenScope
): Effect.Effect<
  void,
  Unauthorized | AuthorizationDenied,
  ApiTokenRegistry | Scope.Scope
> =>
  Effect.gen(function* () {
    const token = bearerToken(request)
    if (!token) {
      yield* annotateWide({ outcome: 'missing_bearer_token' })
      return yield* Effect.fail(new Unauthorized({ message: 'missing_bearer_token' }))
    }
    const registry = yield* ApiTokenRegistry
    const verified = yield* Effect.result(registry.verifyBearerToken(token, scope))
    if (Result.isFailure(verified)) {
      yield* annotateWide({ outcome: 'forbidden', authReason: verified.failure.reason })
      return yield* Effect.fail(
        new AuthorizationDenied({ reason: verified.failure.reason })
      )
    }
    yield* annotateWide({
      tokenId: verified.success.id,
      workspaceId: verified.success.workspaceId,
      tokenWorkspaceSlug: verified.success.workspaceSlug,
      tokenScopes: verified.success.scopes,
      requiredScope: scope
    })
  })

// One canonical wide event per request. annotateWide() calls made by the guards
// and the body all land on this event (see withRequestScope in packages/logger).
const observed = <A, E, R>(
  env: ApiEnv,
  request: HttpServerRequest.HttpServerRequest,
  event: string,
  metadata: Record<string, unknown>,
  body: Effect.Effect<A, E, R>
): Effect.Effect<A, E, Exclude<R, Scope.Scope>> =>
  withRequestScope(
    {
      service: 'api',
      event: `request.${event}`,
      traceId: request.headers[TRACE_HEADER],
      environment: readWideEventEnvironment(env),
      metadata: { pathname: request.url, method: request.method, ...metadata }
    },
    body.pipe(Effect.tap(() => annotateWide({ outcome: 'ok' })))
  )

// ---------------------------------------------------------------------------
// Workspace read effects (require WorkspaceContext + their capability service).
// ---------------------------------------------------------------------------

const workspaceOverviewEffect = Effect.gen(function* () {
  const ctx = yield* WorkspaceContext
  const catalog = yield* StarterModuleCatalog
  const feed = yield* NotificationFeed
  const readiness = yield* AdoptionReadiness
  const [modules, notifications, readinessTrend] = yield* Effect.all(
    [catalog.listModules, feed.list, readiness.getTrend],
    { concurrency: 'unbounded' }
  )
  const readinessSnapshot = projectReadiness(modules.map((module) => module.state))
  return {
    workspace: ctx.workspace,
    readinessScore: readinessSnapshot.score,
    modules,
    notifications,
    readinessTrend
  }
})

// ---------------------------------------------------------------------------
// Group handler layers. Each is a function of `env` so the Cloudflare bindings
// are captured once per isolate when the web handler is built.
// ---------------------------------------------------------------------------

export const healthGroup = (env: ApiEnv) =>
  HttpApiBuilder.group(StarterApi, 'health', (handlers) =>
    handlers.handle('check', ({ request }) =>
      observed(env, request, 'health', {}, Effect.succeed({ status: 'ok' as const }))
    )
  )

export const workspaceGroup = (env: ApiEnv) =>
  HttpApiBuilder.group(StarterApi, 'workspace', (handlers) => {
    const read = <A, E, R>(
      event: string,
      scope: ApiTokenScope,
      slug: string,
      request: HttpServerRequest.HttpServerRequest,
      body: Effect.Effect<A, E, R>
    ) =>
      observed(
        env,
        request,
        `workspace.${event}`,
        { workspaceSlug: slug },
        Effect.gen(function* () {
          yield* enforceRateLimit(request, 'rest_read')
          yield* enforceScope(request, scope)
          return yield* body.pipe(Effect.provide(selectWorkspaceLayer(env, slug)))
        })
      )

    return handlers
      .handle('overview', ({ params, request }) =>
        read('overview', 'read', params.slug, request, workspaceOverviewEffect)
      )
      .handle('modules', ({ params, request }) =>
        read(
          'modules',
          'read',
          params.slug,
          request,
          Effect.flatMap(StarterModuleCatalog, (catalog) => catalog.listModules)
        )
      )
      .handle('members', ({ params, request }) =>
        read(
          'members',
          'read',
          params.slug,
          request,
          Effect.flatMap(WorkspaceMembership, (membership) => membership.listMembers)
        )
      )
      .handle('notifications', ({ params, request }) =>
        read(
          'notifications',
          'read',
          params.slug,
          request,
          Effect.flatMap(NotificationFeed, (feed) => feed.list)
        )
      )
      .handle('api-tokens', ({ params, request }) =>
        read(
          'api-tokens',
          'write',
          params.slug,
          request,
          Effect.flatMap(ApiTokenRegistry, (tokens) => tokens.list)
        )
      )
      .handle('webhooks', ({ params, request }) =>
        read(
          'webhooks',
          'write',
          params.slug,
          request,
          Effect.flatMap(WebhookEndpoints, (webhooks) => webhooks.list)
        )
      )
      .handle('integrations', ({ params, request }) =>
        read(
          'integrations',
          'read',
          params.slug,
          request,
          Effect.flatMap(IntegrationSurfaces, (integrations) => integrations.list)
        )
      )
      .handle('reports', ({ params, request }) =>
        read(
          'reports',
          'read',
          params.slug,
          request,
          Effect.flatMap(ImplementationReports, (reports) => reports.list)
        )
      )
      .handle('audit-events', ({ params, request }) =>
        read(
          'audit-events',
          'read',
          params.slug,
          request,
          Effect.flatMap(AuditEventLog, (log) => log.list)
        )
      )
  })

export const apiTokenGroup = (env: ApiEnv) =>
  HttpApiBuilder.group(StarterApi, 'api-token-registry', (handlers) =>
    handlers
      .handle('create', ({ params, payload, request }) =>
        observed(
          env,
          request,
          'api-tokens.create',
          { workspaceSlug: params.slug },
          Effect.gen(function* () {
            yield* enforceRateLimit(request, 'rest_write')
            yield* enforceScope(request, 'admin')
            const created = yield* Effect.flatMap(ApiTokenRegistry, (tokens) =>
              tokens.create({ name: payload.name, scopes: payload.scopes })
            ).pipe(Effect.provide(selectWorkspaceLayer(env, params.slug)))
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
            yield* enforceScope(request, 'admin')
            yield* Effect.flatMap(ApiTokenRegistry, (tokens) =>
              tokens.revoke({ tokenId: params.tokenId })
            ).pipe(Effect.provide(selectWorkspaceLayer(env, params.slug)))
            return { status: 'revoked' as const }
          })
        )
      )
  )

export const invitationGroup = (env: ApiEnv) =>
  HttpApiBuilder.group(StarterApi, 'workspace-invitations', (handlers) =>
    handlers.handle('send', ({ params, payload, request }) =>
      observed(
        env,
        request,
        'invitations.send',
        { workspaceSlug: params.slug },
        Effect.gen(function* () {
          yield* enforceRateLimit(request, 'invitations')
          yield* enforceScope(request, 'admin')
          return yield* Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const dispatcher = yield* EmailDispatcher
            const host = request.headers.host
            const proto = request.headers['x-forwarded-proto'] ?? 'https'
            const origin = host ? `${proto}://${host}` : ''
            const inviteUrl = `${origin}/invitations/accept?workspace=${ctx.workspace.slug}`
            const delivery = yield* Effect.result(
              dispatcher.send({
                from: env.EMAIL_FROM_ADDRESS ?? 'noreply@example.com',
                to: payload.to,
                subject: `You are invited to ${ctx.workspace.name}`,
                element: WorkspaceInvitationEmail({
                  workspaceName: ctx.workspace.name,
                  inviteUrl
                })
              })
            )
            if (Result.isFailure(delivery)) {
              yield* annotateWide({
                outcome: 'invitation_send_failed',
                emailError: delivery.failure.message
              })
              return yield* Effect.fail(
                new InternalError({
                  traceId: request.headers[TRACE_HEADER] ?? newTraceId()
                })
              )
            }
            return { status: 'queued' as const, delivery: delivery.success }
          }).pipe(Effect.provide(selectWorkspaceLayer(env, params.slug)))
        })
      )
    )
  )

export const catalogGroup = (env: ApiEnv) =>
  HttpApiBuilder.group(StarterApi, 'catalog', (handlers) =>
    handlers
      .handle('modules', ({ request }) =>
        observed(
          env,
          request,
          'catalog.modules',
          {},
          Effect.gen(function* () {
            yield* enforceRateLimit(request, 'rest_read')
            yield* enforceScope(request, 'read')
            return yield* Effect.flatMap(
              StarterModuleCatalog,
              (catalog) => catalog.listAllModules
            )
          })
        )
      )
      .handle('refresh-history', ({ request }) =>
        observed(
          env,
          request,
          'catalog.refresh-history',
          {},
          Effect.gen(function* () {
            yield* enforceRateLimit(request, 'rest_read')
            yield* enforceScope(request, 'read')
            return yield* Effect.flatMap(
              CatalogRefreshHistory,
              (history) => history.listRecent
            )
          })
        )
      )
  )

export const assistantGroup = (env: ApiEnv) =>
  HttpApiBuilder.group(StarterApi, 'assistant', (handlers) =>
    handlers.handle('answer', ({ payload, request }) =>
      observed(
        env,
        request,
        'assistant.answer',
        {},
        Effect.gen(function* () {
          yield* enforceRateLimit(request, 'assistant')
          const service = yield* AssistantService
          const reply = yield* service.ask(payload)
          return {
            answer: reply.answer,
            provider: reply.provider,
            modelId: reply.modelId,
            usedTools: reply.usedTools,
            assistantConfigured: isAssistantConfigured(env)
          }
        })
      )
    )
  )

export const mcpGroup = (env: ApiEnv) =>
  HttpApiBuilder.group(StarterApi, 'mcp', (handlers) =>
    handlers.handle('discover', ({ request }) =>
      observed(
        env,
        request,
        'mcp.discover',
        {},
        Effect.gen(function* () {
          yield* enforceRateLimit(request, 'mcp')
          return {
            name: 'b2b-saas-starter-mcp',
            resources: ['workspace://starter-lab/overview'],
            tools: []
          }
        })
      )
    )
  )
