import { type PermissionRequest } from '@b2b-saas-starter/authz/client'
import { ApiTokenRegistry } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { WebhookEndpoints } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { WorkspaceExports } from '@b2b-saas-starter/capabilities/governance/workspace-export'
import { type ListPageInput } from '@b2b-saas-starter/capabilities/internal/keyset-cursor'
import { StarterApi, WorkspaceExportNotDownloadable } from '@b2b-saas-starter/api'
import { AssistantService, isAssistantConfigured } from '@b2b-saas-starter/ai'
import { Effect, Option, Result } from 'effect'
import { HttpServerRequest } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { type ApiEnv } from './env.ts'
import { enforcePermission, observed, provideWorkspace } from './request-guards.ts'
import { mcpDiscoveryDocument } from './mcp.ts'
import { READ_OPERATIONS, type ReadOperationEndpoint } from './operations.ts'

/**
 * Contract response literals. Each is declared with the literal type the
 * `StarterApi` success schema pins down, so the value is *checked* against the
 * contract instead of asserted with `as const`.
 */
const HEALTH_OK = { status: 'ok' } satisfies { readonly status: 'ok' }
const TOKEN_REVOKED = { status: 'revoked' } satisfies { readonly status: 'revoked' }

/**
 * Write sibling of the local `read` helper in `workspaceGroup`. Bearer auth and
 * the group's rate-limit bucket are the contract's `BearerAuth` middleware's
 * job, so a handler composes only the permission gate and the capability call.
 * The event name is passed whole — writes name themselves
 * (`api-tokens.create`), unlike reads under `workspace.*`.
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
      yield* enforcePermission(permission, slug)
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
          yield* enforcePermission(permission, slug)
          return yield* provideWorkspace(env, slug, body)
        })
      )
    }

    /**
     * Generic in the row, not in the key: the call site hands over the table
     * entry itself, so `A`/`E`/`R` are inferred from that row's own capability
     * read. That is what lets the contract's success and error schemas check
     * the handler — a row whose read stopped answering what its endpoint
     * declares fails here, at compile time, with no channel widening in
     * between. (Taking the key and indexing `READ_OPERATIONS` inside the body
     * cannot work: within the generic body the index resolves to the union of
     * all six rows, and TypeScript rejects the union against any one
     * endpoint's schema.)
     *
     * The decoded `query` rides along: list rows page on it (ADR 0057), and
     * the overview row ignores it — one shape for every row of the table.
     */
    function workspaceRead<A, E, R>(
      op: {
        readonly path: ReadOperationEndpoint
        readonly permission: PermissionRequest
        readonly read: (page?: ListPageInput) => Effect.Effect<A, E, R>
      },
      params: { readonly slug: string },
      query: ListPageInput | undefined,
      request: HttpServerRequest.HttpServerRequest
    ) {
      return read(op.path, op.permission, params.slug, request, op.read(query))
    }

    // Every read composes gate + capability from the shared operation
    // table (operations.ts) — the same rows the MCP tools are derived from,
    // so the two Capability Interfaces cannot disagree about permissions.
    return handlers
      .handle('overview', ({ params, request }) =>
        workspaceRead(READ_OPERATIONS.overview, params, undefined, request)
      )
      .handle('members', ({ params, query, request }) =>
        workspaceRead(READ_OPERATIONS.members, params, query, request)
      )
      .handle('notifications', ({ params, query, request }) =>
        workspaceRead(READ_OPERATIONS.notifications, params, query, request)
      )
      .handle('api-tokens', ({ params, query, request }) =>
        workspaceRead(READ_OPERATIONS['api-tokens'], params, query, request)
      )
      .handle('webhooks', ({ params, query, request }) =>
        workspaceRead(READ_OPERATIONS.webhooks, params, query, request)
      )
      .handle('audit-events', ({ params, query, request }) =>
        workspaceRead(READ_OPERATIONS['audit-events'], params, query, request)
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

/**
 * Workspace data export over the REST surface (ADR 0055). `request` enqueues
 * the job; `download-link` mints the signed URL, re-checking the permission on
 * the way — the link then points at the public signed route on this worker,
 * so it is prefixed with this request's own origin.
 */
export function workspaceExportGroup(env: ApiEnv) {
  return HttpApiBuilder.group(StarterApi, 'workspace-exports', (handlers) =>
    handlers
      .handle('request', ({ params, request }) =>
        write(
          env,
          'workspace-exports.request',
          { workspaceExport: ['request'] },
          params.slug,
          request,
          Effect.gen(function* () {
            const exports = yield* WorkspaceExports
            const created = yield* exports.request
            yield* Effect.annotateLogsScoped({ exportId: created.id })
            return created
          })
        )
      )
      .handle('download-link', ({ params, request }) =>
        write(
          env,
          'workspace-exports.download-link',
          { workspaceExport: ['download'] },
          params.slug,
          request,
          Effect.gen(function* () {
            const exports = yield* WorkspaceExports
            const link = yield* exports.issueDownloadLink({ exportId: params.exportId })
            if (Option.isNone(link)) {
              return yield* new WorkspaceExportNotDownloadable({
                exportId: params.exportId
              })
            }
            const origin = yield* requestOrigin
            yield* Effect.annotateLogsScoped({ exportId: params.exportId })
            return {
              url: `${origin}${link.value.path}`,
              expiresAt: link.value.expiresAt
            }
          })
        )
      )
  )
}

/**
 * This request's own origin — where the signed download route lives. Read off
 * the worker's `Request` (the same `toWebResult` conversion `observed` uses);
 * a request with no derivable URL falls back to its `host` header.
 */
const requestOrigin = Effect.map(HttpServerRequest.HttpServerRequest, (request) => {
  const web = HttpServerRequest.toWebResult(request)
  if (Result.isSuccess(web)) {
    return new URL(web.success.url).origin
  }
  return `https://${request.headers.host ?? 'localhost'}`
})

export function assistantGroup(env: ApiEnv) {
  return HttpApiBuilder.group(StarterApi, 'assistant', (handlers) =>
    handlers.handle('answer', ({ payload, request }) =>
      observed(
        env,
        request,
        'assistant.answer',
        {},
        Effect.gen(function* () {
          yield* enforcePermission({ assistant: ['read'] })
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
          yield* enforcePermission({ mcp: ['read'] })
          return mcpDiscoveryDocument()
        })
      )
    )
  )
}
