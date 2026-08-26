import { type PermissionRequest } from '@b2b-saas-starter/authz/client'
import { ApiTokenRegistry } from '@b2b-saas-starter/capabilities/src/developer-platform/api-token-registry.ts'
import { WebhookEndpoints } from '@b2b-saas-starter/capabilities/src/developer-platform/webhook-endpoints.ts'
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
import { READ_OPERATIONS, serveRead, type ReadOperationEndpoint } from './operations.ts'

/**
 * Contract response literals. Each is declared with the literal type the
 * `StarterApi` success schema pins down, so the value is *checked* against the
 * contract instead of asserted with `as const`.
 */
const HEALTH_OK = { status: 'ok' } satisfies { readonly status: 'ok' }
const TOKEN_REVOKED = { status: 'revoked' } satisfies { readonly status: 'revoked' }

/**
 * Write sibling of the local `read` helper in `workspaceGroup`: the same gate
 * stack with the write rate-limit bucket. The event name is passed whole —
 * writes name themselves (`api-tokens.create`), unlike reads under
 * `workspace.*`.
 */
function write<A, E, R>(
  env: ApiEnv,
  event: string,
  permission: PermissionRequest,
  slug: string,
  request: HttpServerRequest.HttpServerRequest,
  body: Effect.Effect<A, E, R>
) {
  return observed(
    env,
    request,
    event,
    { workspaceSlug: slug },
    Effect.gen(function* () {
      yield* enforceRateLimit(request, 'rest_write')
      yield* enforcePermission(request, permission, slug)
      return yield* provideWorkspace(env, slug, body)
    })
  )
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

    // Every read goes through `serveRead` — the one documented channel
    // widening, owned by the shared operation table.
    function workspaceRead(
      endpoint: ReadOperationEndpoint,
      params: { readonly slug: string },
      request: HttpServerRequest.HttpServerRequest
    ) {
      const op = READ_OPERATIONS[endpoint]
      return read(endpoint, op.permission, params.slug, request, serveRead(op))
    }

    // Every read composes gate + capability from the shared operation
    // table (operations.ts) — the same rows the MCP tools are derived from,
    // so the two Capability Interfaces cannot disagree about permissions.
    return handlers
      .handle('overview', ({ params, request }) =>
        workspaceRead('overview', params, request)
      )
      .handle('members', ({ params, request }) =>
        workspaceRead('members', params, request)
      )
      .handle('notifications', ({ params, request }) =>
        workspaceRead('notifications', params, request)
      )
      .handle('api-tokens', ({ params, request }) =>
        workspaceRead('api-tokens', params, request)
      )
      .handle('webhooks', ({ params, request }) =>
        workspaceRead('webhooks', params, request)
      )
      .handle('audit-events', ({ params, request }) =>
        workspaceRead('audit-events', params, request)
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
    return write(
      env,
      event,
      { apiToken: ['revoke'] },
      params.slug,
      request,
      Effect.gen(function* () {
        const tokens = yield* ApiTokenRegistry
        yield* tokens.revoke({ tokenId: params.tokenId })
        return TOKEN_REVOKED
      })
    )
  }

  return HttpApiBuilder.group(StarterApi, 'api-token-registry', (handlers) =>
    handlers
      .handle('create', ({ params, payload, request }) =>
        write(
          env,
          'api-tokens.create',
          { apiToken: ['create'] },
          params.slug,
          request,
          Effect.gen(function* () {
            const tokens = yield* ApiTokenRegistry
            // The entitlement gate and the webhook fan-out live inside the
            // capability, below the interface — identical for every surface.
            const created = yield* tokens.create({
              name: payload.name,
              scopes: payload.scopes
            })
            yield* Effect.annotateLogsScoped({
              tokenId: created.id,
              tokenScopes: created.scopes
            })
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
      write(
        env,
        'webhooks.create',
        { webhook: ['create'] },
        params.slug,
        request,
        Effect.gen(function* () {
          const webhooks = yield* WebhookEndpoints
          const created = yield* webhooks.create({
            url: payload.url,
            events: payload.events,
            description: payload.description
          })
          yield* Effect.annotateLogsScoped({ webhookEndpointId: created.endpoint.id })
          return created.endpoint
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
