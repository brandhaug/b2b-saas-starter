import { tokenPrincipal, type PermissionRequest } from '@b2b-saas-starter/authz/client'
import { type ListPageInput } from '@b2b-saas-starter/capabilities/internal/keyset-cursor'
import { ApiTokenRegistry } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { WebhookEndpoints } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import { WorkspaceExports } from '@b2b-saas-starter/capabilities/governance/workspace-export'
import { ApiPrincipal, StarterApi } from '@b2b-saas-starter/api'
import { AssistantService, isAssistantConfigured } from '@b2b-saas-starter/ai'
import { Context, Effect } from 'effect'
import { type HttpServerRequest } from 'effect/unstable/http'
import { HttpApiBuilder } from 'effect/unstable/httpapi'

import { type ApiEnv } from './env.ts'
import {
  enforcePermission,
  observed,
  provideWorkspace,
  webRequest
} from './request-guards.ts'
import { mcpDiscoveryDocument } from './mcp.ts'
import {
  type MutationRequestOptions,
  MUTATION_OPERATIONS,
  OperationOrigin,
  OperationPrincipal,
  READ_OPERATIONS
} from './operations.ts'

/**
 * Contract response literal. Declared with the literal type the `StarterApi`
 * success schema pins down, so the value is *checked* against the contract
 * instead of asserted with `as const`.
 */
const HEALTH_OK = { status: 'ok' } satisfies { readonly status: 'ok' }

/**
 * The one wrapper every workspace-scoped handler composes — reads and writes
 * alike: the permission gate, the per-slug workspace layer, and the request's
 * wide event. Bearer auth and the group's rate-limit bucket are the contract's
 * `BearerAuth` middleware's job, so a handler composes only this and the
 * capability call. The event name is passed whole — reads sit under
 * `workspace.*` (see `workspaceRead`), a write's table key is its event
 * (`api-tokens.create`, see `workspaceWrite`).
 *
 * Every REST workspace operation rides a bearer token, so the workspace layer
 * the body runs against carries the `api_token` caller kind — the label a
 * mutating capability's audit row then records.
 */
function workspaceOperation<A, E, R>(
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
      const principal = yield* ApiPrincipal
      return yield* provideWorkspace(env, slug, body, undefined, 'api_token').pipe(
        Effect.provideService(OperationPrincipal, tokenPrincipal(principal.scopes)),
        Effect.provideService(OperationOrigin, new URL(webRequest(request).url).origin)
      )
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
    // Infer each concrete row's input, success, errors, and requirements rather
    // than widening to the union of reads. HttpApiBuilder checks the result
    // against that endpoint's contract. Parameterized reads require endpointId.
    function workspaceRead<Args extends { readonly endpointId?: string }, A, E, R>(
      op: {
        readonly endpoint: { readonly identifier: string }
        readonly permission: PermissionRequest
        readonly read: (
          page: ListPageInput | undefined,
          args: Args
        ) => Effect.Effect<A, E, R>
      },
      params: Args & { readonly slug: string },
      query: ListPageInput | undefined,
      request: HttpServerRequest.HttpServerRequest
    ) {
      // The decoded `query` rides along: paged list rows page on it (ADR
      // 0057), the overview row ignores it — one shape for every row of the
      // table. The one parameterized read names which endpoint it served, the
      // same way the write handlers annotate ids below.
      return workspaceOperation(
        env,
        `workspace.${op.endpoint.identifier}`,
        op.permission,
        params.slug,
        request,
        Effect.gen(function* () {
          if (params.endpointId !== undefined) {
            yield* Effect.annotateLogsScoped({ endpointId: params.endpointId })
          }
          return yield* op.read(query, params)
        })
      )
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
      .handle('webhook-deliveries', ({ params, request }) =>
        workspaceRead(READ_OPERATIONS['webhook-deliveries'], params, undefined, request)
      )
      .handle('audit-events', ({ params, query, request }) =>
        workspaceRead(READ_OPERATIONS['audit-events'], params, query, request)
      )
  })
}

/** Preserve each row's input, result and errors through contract registration. */
function workspaceWrites<Services>(
  env: ApiEnv,
  services: Context.Context<Services>,
  eventPrefix: string
) {
  return function workspaceWrite<Options extends MutationRequestOptions, A, E, R>(op: {
    readonly endpoint: { readonly identifier: string }
    readonly permission: PermissionRequest
    readonly run: (options: Options) => Effect.Effect<A, E, R>
  }) {
    return (
      options: Options & {
        readonly params: { readonly slug: string }
        readonly request: HttpServerRequest.HttpServerRequest
      }
    ) =>
      workspaceOperation(
        env,
        `${eventPrefix}.${op.endpoint.identifier}`,
        op.permission,
        options.params.slug,
        options.request,
        Effect.suspend(() => op.run(options)).pipe(Effect.provide(services))
      )
  }
}

// Explicit endpoint bindings preserve HttpApiBuilder's per-endpoint schema
// checks. Permissions, calls and response/error shaping belong to the rows.
export function apiTokenGroup(env: ApiEnv) {
  return HttpApiBuilder.group(StarterApi, 'api-token-registry', (handlers) =>
    Effect.gen(function* () {
      const tokens = yield* ApiTokenRegistry
      const write = workspaceWrites(
        env,
        Context.make(ApiTokenRegistry, tokens),
        'api-tokens'
      )
      return handlers.handleAll({
        create: write(MUTATION_OPERATIONS['api-tokens.create']),
        delete: write(MUTATION_OPERATIONS['api-tokens.delete'])
      })
    })
  )
}

export function webhookGroup(env: ApiEnv) {
  return HttpApiBuilder.group(StarterApi, 'webhook-endpoints', (handlers) =>
    Effect.gen(function* () {
      const webhooks = yield* WebhookEndpoints
      const write = workspaceWrites(
        env,
        Context.make(WebhookEndpoints, webhooks),
        'webhooks'
      )
      return handlers.handleAll({
        create: write(MUTATION_OPERATIONS['webhooks.create']),
        update: write(MUTATION_OPERATIONS['webhooks.update']),
        delete: write(MUTATION_OPERATIONS['webhooks.delete']),
        'rotate-secret': write(MUTATION_OPERATIONS['webhooks.rotate-secret']),
        'test-event': write(MUTATION_OPERATIONS['webhooks.test-event']),
        'replay-delivery': write(MUTATION_OPERATIONS['webhooks.replay-delivery'])
      })
    })
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

/**
 * Workspace data export over the REST surface (ADR 0055): `request` enqueues
 * the job; `download-link` mints the signed URL, re-checking the permission
 * on the way — the link then points at the public signed route on this worker,
 * so it is prefixed with this request's own origin (the one request-derived
 * success in the table; see the download-link row).
 */
export function workspaceExportGroup(env: ApiEnv) {
  return HttpApiBuilder.group(StarterApi, 'workspace-exports', (handlers) =>
    Effect.gen(function* () {
      const exports = yield* WorkspaceExports
      const write = workspaceWrites(
        env,
        Context.make(WorkspaceExports, exports),
        'workspace-exports'
      )
      return handlers.handleAll({
        request: write(MUTATION_OPERATIONS['workspace-exports.request']),
        'download-link': write(MUTATION_OPERATIONS['workspace-exports.download-link'])
      })
    })
  )
}
