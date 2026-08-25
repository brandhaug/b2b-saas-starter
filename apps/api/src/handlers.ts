import { annotateWide } from '@b2b-saas-starter/logger'
import { type PermissionRequest } from '@b2b-saas-starter/authz/src/client.ts'
import { ApiTokenRegistry } from '@b2b-saas-starter/capabilities/src/developer-platform/api-token-registry.ts'
import { AuditEventLog } from '@b2b-saas-starter/capabilities/src/governance/audit-event-log.ts'
import { NotificationFeed } from '@b2b-saas-starter/capabilities/src/notifications/notification-feed.ts'
import { WebhookEndpoints } from '@b2b-saas-starter/capabilities/src/developer-platform/webhook-endpoints.ts'
import { workspaceOverview } from '@b2b-saas-starter/capabilities/src/workspace-projections.ts'
import { WorkspaceMembership } from '@b2b-saas-starter/capabilities/src/governance/workspace-membership.ts'
import { StarterApi } from '@b2b-saas-starter/api'
import { AssistantService, isAssistantConfigured } from '@b2b-saas-starter/ai'
import { Effect } from 'effect'
import { type HttpServerRequest } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { providerEnv, type ApiEnv } from './env.ts'
import {
  enforcePermission,
  enforceRateLimit,
  observed,
  provideWorkspace
} from './request-guards.ts'
import { mcpDiscoveryDocument } from './mcp.ts'

/**
 * Contract response literals. Each is declared with the literal type the
 * `StarterApi` success schema pins down, so the value is *checked* against the
 * contract instead of asserted with `as const`.
 */
const HEALTH_OK = { status: 'ok' } satisfies { readonly status: 'ok' }
const TOKEN_REVOKED = { status: 'revoked' } satisfies { readonly status: 'revoked' }

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
        // Listing members exposes who holds which role, which is what `ac`
        // (Better Auth's abbreviation of "access control") names. The key is
        // fixed by the plugin; see statements.ts. The plugin's `member`
        // statement covers mutations only — it has no `read` action.
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
            Effect.flatMap(AuditEventLog, (log) =>
              Effect.map(log.list(), (page) => page.events)
            )
          )
        )
    )
  })
}

export function apiTokenGroup(env: ApiEnv) {
  // `revoke` and `delete` are the same operation on this registry — the schema
  // keeps both routes for REST-shape compatibility, and both answer
  // identically. Only the wide-event name distinguishes them.
  function revokeOrDelete(
    event: 'api-tokens.revoke' | 'api-tokens.delete',
    params: { readonly slug: string; readonly tokenId: string },
    request: HttpServerRequest.HttpServerRequest
  ) {
    return observed(
      env,
      request,
      event,
      { workspaceSlug: params.slug },
      Effect.gen(function* () {
        yield* enforceRateLimit(request, 'rest_write')
        yield* enforcePermission(request, { apiToken: ['revoke'] }, params.slug)
        yield* provideWorkspace(
          env,
          params.slug,
          Effect.gen(function* () {
            const tokens = yield* ApiTokenRegistry
            yield* tokens.revoke({ tokenId: params.tokenId })
          })
        )
        return TOKEN_REVOKED
      })
    )
  }

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
                // The entitlement gate and the webhook fan-out live inside the
                // capability, below the interface — identical for every
                // surface.
                const next = yield* tokens.create({
                  name: payload.name,
                  scopes: payload.scopes
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
        revokeOrDelete('api-tokens.revoke', params, request)
      )
      .handle('delete', ({ params, request }) =>
        revokeOrDelete('api-tokens.delete', params, request)
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
              const createdEndpoint = yield* webhooks.create({
                url: payload.url,
                events: payload.events,
                description: payload.description
              })
              return createdEndpoint.endpoint
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
          yield* enforcePermission(request, { assistant: ['read'] })
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
          yield* enforcePermission(request, { mcp: ['read'] })
          return mcpDiscoveryDocument()
        })
      )
    )
  )
}
