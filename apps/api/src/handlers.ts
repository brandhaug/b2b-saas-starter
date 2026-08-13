import { Effect, Result, type Scope } from 'effect'
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
  ApiTokenRegistry,
  type ApiToken,
  type ApiTokenScope,
  AuditEventLog,
  AuthorizationDenied,
  type CapabilityUnavailable,
  CatalogRefreshHistory,
  type CreateWebhookEndpointInput,
  ImplementationReports,
  IntegrationSurfaces,
  NotificationFeed,
  selectWorkspaceLayer,
  StarterModuleCatalog,
  type WebhookEndpoint,
  WebhookEndpoints,
  WebhookPublisher,
  workspaceOverview,
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
import { emailFromAddress, providerEnv, starterEnv, type ApiEnv } from './env.ts'
import { RateLimiter, type RateLimitBucket } from './rate-limit.ts'

/**
 * Contract response literals. Each is declared with the literal type the
 * `StarterApi` success schema pins down, so the value is *checked* against the
 * contract instead of asserted with `as const`.
 */
const HEALTH_OK: { readonly status: 'ok' } = { status: 'ok' }
const TOKEN_REVOKED: { readonly status: 'revoked' } = { status: 'revoked' }
const INVITATION_QUEUED: { readonly status: 'queued' } = { status: 'queued' }

function clientKey(request: HttpServerRequest.HttpServerRequest): string {
  return request.headers['cf-connecting-ip'] ?? `unkeyed:${request.url}`
}

function bearerToken(request: HttpServerRequest.HttpServerRequest): string | null {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) return null
  return header.slice('Bearer '.length).trim()
}

/**
 * Origin the invitation link points back at. Empty when the request carried no
 * `host` header, which keeps the accept URL relative rather than pointing at a
 * fabricated host.
 */
function requestOrigin(request: HttpServerRequest.HttpServerRequest): string {
  const host = request.headers.host
  if (!host) return ''
  const proto = request.headers['x-forwarded-proto'] ?? 'https'
  return `${proto}://${host}`
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

function enforceScope(
  request: HttpServerRequest.HttpServerRequest,
  scope: ApiTokenScope,
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
    const verified = yield* Effect.result(registry.verifyBearerToken(token, scope))
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
      if (failure.reason === 'invalid_token') {
        yield* annotateWide({ outcome: 'unauthorized', authReason: failure.reason })
        return yield* Effect.fail(new Unauthorized({ message: failure.reason }))
      }
      yield* annotateWide({ outcome: 'forbidden', authReason: failure.reason })
      return yield* Effect.fail(new AuthorizationDenied({ reason: failure.reason }))
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
      tokenScopes: verified.success.scopes,
      requiredScope: scope
    })
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
      environment: readWideEventEnvironment(env),
      metadata: { pathname: request.url, method: request.method, ...metadata }
    },
    body.pipe(Effect.tap(() => annotateWide({ outcome: 'ok' })))
  )
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
  | {
      readonly eventType: 'workspace_invitation.sent'
      readonly payload: { readonly workspaceSlug: string; readonly to: string }
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
      scope: ApiTokenScope,
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
          yield* enforceScope(request, scope, slug)
          return yield* provideWorkspace(env, slug, body)
        })
      )
    }

    return handlers
      .handle('overview', ({ params, request }) =>
        read('overview', 'read', params.slug, request, workspaceOverview)
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
          'read',
          params.slug,
          request,
          Effect.flatMap(ApiTokenRegistry, (tokens) => tokens.list)
        )
      )
      .handle('webhooks', ({ params, request }) =>
        read(
          'webhooks',
          'read',
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
            yield* enforceScope(request, 'admin', params.slug)
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
            yield* enforceScope(request, 'admin', params.slug)
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
            yield* enforceScope(request, 'admin', params.slug)
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
          yield* enforceScope(request, 'write', params.slug)
          const created = yield* provideWorkspace(
            env,
            params.slug,
            Effect.gen(function* () {
              const webhooks = yield* WebhookEndpoints
              // `description` is optional in the contract and in the
              // capability input: set the key only when the client sent one,
              // instead of passing an explicit undefined.
              const createInput: {
                -readonly [
                  K in keyof CreateWebhookEndpointInput
                ]: CreateWebhookEndpointInput[K]
              } = { url: payload.url, events: payload.events }
              if (payload.description !== undefined) {
                createInput.description = payload.description
              }
              const endpoint = yield* webhooks.create(createInput)
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

export function invitationGroup(env: ApiEnv) {
  return HttpApiBuilder.group(StarterApi, 'workspace-invitations', (handlers) =>
    handlers.handle('send', ({ params, payload, request }) =>
      observed(
        env,
        request,
        'invitations.send',
        { workspaceSlug: params.slug },
        Effect.gen(function* () {
          yield* enforceRateLimit(request, 'invitations')
          yield* enforceScope(request, 'admin', params.slug)
          return yield* provideWorkspace(
            env,
            params.slug,
            Effect.gen(function* () {
              const ctx = yield* WorkspaceContext
              const dispatcher = yield* EmailDispatcher
              const inviteUrl = `${requestOrigin(request)}/invitations/accept?workspace=${ctx.workspace.slug}`
              const delivery = yield* Effect.result(
                dispatcher.send({
                  from: emailFromAddress(env) ?? 'noreply@example.com',
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
              yield* publishWebhookEvent({
                eventType: 'workspace_invitation.sent',
                payload: { workspaceSlug: ctx.workspace.slug, to: payload.to }
              })
              return { ...INVITATION_QUEUED, delivery: delivery.success }
            })
          )
        })
      )
    )
  )
}

export function catalogGroup(env: ApiEnv) {
  return HttpApiBuilder.group(StarterApi, 'catalog', (handlers) =>
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
          yield* enforceScope(request, 'read')
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
          yield* enforceScope(request, 'read')
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
