import { McpServer } from '@modelcontextprotocol/server'
import { type JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import {
  tokenPrincipal,
  type PermissionRequest
} from '@b2b-saas-starter/authz/src/client.ts'
import { requirePermission } from '@b2b-saas-starter/authz/src/guard.ts'
import { ApiTokenRegistry } from '@b2b-saas-starter/capabilities/src/developer-platform/api-token-registry.ts'
import { WebhookEndpoints } from '@b2b-saas-starter/capabilities/src/developer-platform/webhook-endpoints.ts'
import { AuditEventLog } from '@b2b-saas-starter/capabilities/src/governance/audit-event-log.ts'
import { WorkspaceMembership } from '@b2b-saas-starter/capabilities/src/governance/workspace-membership.ts'
import { NotificationFeed } from '@b2b-saas-starter/capabilities/src/notifications/notification-feed.ts'
import { workspaceOverview } from '@b2b-saas-starter/capabilities/src/workspace-projections.ts'
import {
  type RateLimited,
  type Unauthorized,
  type McpDiscovery,
  type McpToolDescriptor
} from '@b2b-saas-starter/api'
import {
  HttpRouter,
  HttpServerResponse,
  type HttpServerRequest
} from 'effect/unstable/http'
import { Effect, Result, Stream } from 'effect'
import { type ApiTokenScope } from '@b2b-saas-starter/authz/src/roles.ts'
import { type WorkspaceContext } from '@b2b-saas-starter/capabilities/src/workspace-context.ts'
import { createMcpHandler } from 'agents/mcp/server'
import { z } from 'zod'

import { type AuthorizationDenied } from '@b2b-saas-starter/authz/src/errors.ts'
import { type CapabilityUnavailable } from '@b2b-saas-starter/capabilities/src/errors.ts'

import {
  authenticate,
  enforceRateLimit,
  observed,
  provideWorkspace
} from './request-guards.ts'
import { type ApiEnv } from './env.ts'

/**
 * The MCP Capability Interface: a real Model Context Protocol server served at
 * `POST /mcp`, following Cloudflare's recommended path for stateless servers
 * on Workers — `createMcpHandler()` from the Agents SDK over an MCP SDK v2
 * server factory (`@modelcontextprotocol/server`). No Durable Object, no
 * session state, no hand-rolled transport: the Agents handler owns the wire
 * protocol end to end.
 *
 * The protocol route sits outside the `StarterApi` contract on purpose —
 * JSON-RPC over streamable HTTP is its own wire shape, not a REST operation —
 * so it never appears in the OpenAPI document or the permission matrix. It
 * shares everything that matters with the REST groups: one bearer-token
 * authentication path (`authenticate`), the same `requirePermission` guard
 * per tool, the same `mcp` rate-limit bucket, and the same capability
 * services underneath.
 *
 * A fresh handler is created per request (explicitly supported by the Agents
 * docs for ordinary tools/resources), closing over the verified token's
 * workspace so every tool reads from the right tenant.
 *
 * `GET /mcp` remains the REST discovery document served by the contract group;
 * it advertises exactly what this module registers.
 */

export const MCP_SERVER_NAME = 'b2b-saas-starter-mcp'
const OVERVIEW_RESOURCE_URI = 'workspace://overview'

type CapabilityRead = Effect.Effect<
  unknown,
  unknown,
  | NotificationFeed
  | WorkspaceMembership
  | ApiTokenRegistry
  | WebhookEndpoints
  | AuditEventLog
  | WorkspaceContext
>

/**
 * The advertised tools, in one place: `GET /mcp` discovery serves these exact
 * descriptors, and `tools/list` answers from registrations built beside them.
 * Every tool is a read over a surviving capability — MCP exposes what REST
 * exposes, nothing resurrected. Each entry also names the permission enforced
 * per invocation, mirroring its REST counterpart.
 */
type ToolDefinition = {
  readonly descriptor: McpToolDescriptor
  readonly permission: PermissionRequest
  readonly capability: () => CapabilityRead
}

export const mcpTools: readonly ToolDefinition[] = [
  {
    descriptor: {
      name: 'list_notifications',
      description:
        "List the API token's workspace notifications, mirroring GET /workspaces/{slug}/notifications.",
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    },
    permission: { notification: ['read'] },
    capability: () => Effect.flatMap(NotificationFeed, (feed) => feed.list)
  },
  {
    descriptor: {
      name: 'get_workspace_overview',
      description:
        'The workspace record plus its notification feed, mirroring GET /workspaces/{slug}/overview.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    },
    permission: { notification: ['read'] },
    capability: () => workspaceOverview
  },
  {
    descriptor: {
      name: 'list_members',
      description:
        'List the workspace members and their roles, mirroring GET /workspaces/{slug}/members.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    },
    permission: { ac: ['read'] },
    capability: () =>
      Effect.flatMap(WorkspaceMembership, (membership) => membership.listMembers)
  },
  {
    descriptor: {
      name: 'list_api_tokens',
      description:
        'List the workspace API token projections (never the secrets), mirroring GET /workspaces/{slug}/api-tokens.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    },
    permission: { apiToken: ['list'] },
    capability: () => Effect.flatMap(ApiTokenRegistry, (tokens) => tokens.list)
  },
  {
    descriptor: {
      name: 'list_webhooks',
      description:
        'List registered webhook endpoints and their success rates, mirroring GET /workspaces/{slug}/webhooks.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    },
    permission: { webhook: ['list'] },
    capability: () => Effect.flatMap(WebhookEndpoints, (webhooks) => webhooks.list)
  },
  {
    descriptor: {
      name: 'list_audit_events',
      description:
        'Read a page of the workspace audit trail, mirroring GET /workspaces/{slug}/audit-events.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    },
    permission: { auditLog: ['read'] },
    capability: () =>
      Effect.map(
        Effect.flatMap(AuditEventLog, (log) => log.list()),
        (page) => page.events
      )
  }
]

/** What `GET /mcp` advertises — derived from the same table `tools/list` serves. */
export function mcpDiscoveryDocument(): McpDiscovery {
  return {
    name: MCP_SERVER_NAME,
    resources: [OVERVIEW_RESOURCE_URI],
    tools: mcpTools.map((tool) => tool.descriptor)
  }
}

/**
 * Tool results are the JSON-RPC wire encoding of already-typed capability
 * values: `unknown` here is the protocol's own payload type, decoded nowhere
 * further because the capability layer produced it.
 */
// oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, effect/noAs, effect/noTernary, anti-slop/require-safety-comment-for-type-assertion -- this block classifies untyped errors crossing the SDK's promise seam; the tag check IS the contract

// The JSON-RPC wire format carries opaque JSON payloads; serializing the
// already-typed capability results here IS the encoding step.
// oxlint-disable-next-line effect/noGlobals -- JSON-RPC wire serialization of typed capability results
function textResult(data: unknown): ToolResult {
  return {
    // oxlint-disable-next-line effect/noGlobals -- see above: this is the wire encoding
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
  }
}

type ToolResult = {
  content: [{ type: 'text'; text: string }]
  isError?: boolean
}

function errorResult(error: unknown): ToolResult {
  // Typed failures keep their meaning across the JSON-RPC boundary; anything
  // else is reported without internals leaking into the client's transcript.
  const tag = tagOf(error)
  if (tag === 'AuthorizationDenied') {
    const reason =
      error !== null && typeof error === 'object' && 'reason' in error
        ? String(error.reason)
        : 'not permitted'
    return {
      content: [{ type: 'text', text: `denied: ${reason}` }],
      isError: true
    }
  }
  if (tag === 'CapabilityUnavailable') {
    return {
      content: [{ type: 'text', text: 'capability unavailable in this environment' }],
      isError: true
    }
  }
  return {
    content: [{ type: 'text', text: 'tool failed; see the API worker logs' }],
    isError: true
  }
}

/** Reads the `_tag` discriminant off an Effect typed error crossing the seam. */
function tagOf(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && '_tag' in error) {
    return String(error._tag)
  }
  return undefined
}
// oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, effect/noAs, effect/noTernary, anti-slop/require-safety-comment-for-type-assertion

/**
 * Builds one stateless server instance for a single request, bound to the
 * verified token's workspace. Every invocation re-checks its own permission
 * against the token's scopes first — the route gate only proved `mcp:read`;
 * a tool must never serve data its REST counterpart would deny.
 *
 * Tool callbacks are the one place this worker leaves Effect-land: the SDK
 * invokes plain async functions, so each callback bridges back onto the
 * request-scoped workspace layer with `Effect.runPromise`.
 */
export function buildMcpServer(
  env: ApiEnv,
  scopes: readonly ApiTokenScope[],
  workspaceSlug: string
): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: '0.1.0' },
    { capabilities: { tools: {}, resources: {} } }
  )

  for (const tool of mcpTools) {
    server.registerTool(
      tool.descriptor.name,
      {
        title: tool.descriptor.name,
        description: tool.descriptor.description,
        inputSchema: z.object({})
      },
      () => {
        // One guard + one capability read, bridged onto the request-scoped
        // workspace layer. `requirePermission` needs a Scope, which only exists
        // inside the Effect runtime, hence the scoped wrapper here rather than
        // in the capability itself.
        const guarded = Effect.gen(function* () {
          yield* requirePermission(tokenPrincipal(scopes), tool.permission)
          return yield* tool.capability()
        }).pipe(Effect.scoped)

        return Effect.runPromise(provideWorkspace(env, workspaceSlug, guarded)).then(
          textResult,
          errorResult
        )
      }
    )
  }

  server.registerResource(
    'workspace-overview',
    OVERVIEW_RESOURCE_URI,
    {
      title: 'Workspace overview',
      description:
        "The API token's workspace record with its notification feed, as JSON."
    },
    () => {
      const guarded = Effect.map(workspaceOverview, (overview) => ({
        contents: [
          {
            uri: OVERVIEW_RESOURCE_URI,
            // oxlint-disable-next-line effect/noGlobals -- MCP resource contents are JSON text by protocol definition
            text: JSON.stringify(overview, null, 2),
            mimeType: 'application/json'
          }
        ]
      }))
      return Effect.runPromise(provideWorkspace(env, workspaceSlug, guarded))
    }
  )

  return server
}

/** Adapts a fetch `Response` into the Effect response type the router serves. */
function fromWeb(response: Response): HttpServerResponse.HttpServerResponse {
  const status = response.status
  const body = response.body
  if (body === null) return HttpServerResponse.empty({ status })
  return HttpServerResponse.stream(
    Stream.fromReadableStream({
      evaluate: () => body,
      onError: (cause) => cause
    }),
    {
      status,
      contentType: response.headers.get('content-type') ?? 'application/json'
    }
  )
}

type ProtocolFailure =
  | Unauthorized
  | AuthorizationDenied
  | RateLimited
  | CapabilityUnavailable

/** The two body shapes a streamable-HTTP response can carry. */
type JsonRpcResponseBody = JSONRPCMessage | RpcErrorBody | { readonly _tag: string }

type RpcErrorBody = {
  readonly jsonrpc: '2.0'
  readonly id: string | number | null
  readonly error: { readonly code: number; readonly message: string }
}

function jsonResponse(
  body: JsonRpcResponseBody,
  status: number
): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.jsonUnsafe(body, { status })
}

function rpcError(code: number, message: string): RpcErrorBody {
  return { jsonrpc: '2.0', id: null, error: { code, message } }
}

/** Maps guard failures to HTTP statuses, the same semantics the contract has. */
function failureResponse(
  error: ProtocolFailure
): HttpServerResponse.HttpServerResponse {
  switch (error._tag) {
    case 'Unauthorized': {
      return jsonResponse({ _tag: 'Unauthorized' }, 401)
    }
    case 'AuthorizationDenied': {
      return jsonResponse({ _tag: 'AuthorizationDenied' }, 403)
    }
    case 'RateLimited': {
      return jsonResponse({ _tag: 'RateLimited' }, 429)
    }
    case 'CapabilityUnavailable': {
      return jsonResponse({ _tag: 'CapabilityUnavailable' }, 503)
    }
  }
}

/**
 * The `POST /mcp` handler: rate-limit, authenticate, prove `mcp:read`, then
 * hand the request to the Agents SDK handler. Guard failures escape the body
 * so `observed` records them like any other rejected request; everything past
 * the gate — parsing included — is the Agents handler's job, fed the
 * pre-parsed body through `fetch(request, { parsedBody })`.
 */
function protocolBody(env: ApiEnv, request: HttpServerRequest.HttpServerRequest) {
  return Effect.gen(function* () {
    yield* enforceRateLimit(request, 'mcp')
    const verified = yield* authenticate(request)
    // `observed` supplies the request Scope that `requirePermission` needs.
    yield* requirePermission(tokenPrincipal(verified.scopes), { mcp: ['read'] })

    const raw = yield* Effect.result(request.text)
    if (Result.isFailure(raw)) {
      return jsonResponse(rpcError(-32_700, 'parse error'), 400)
    }

    const parsed = yield* Effect.result(
      // oxlint-disable-next-line effect/noTryCatch, effect/noAs, effect/noGlobals -- the Agents SDK validates the forwarded body itself; this parse only turns bytes into objects at the promise seam
      Effect.try((): JSONRPCMessage => JSON.parse(raw.success))
    )
    if (Result.isFailure(parsed)) {
      return jsonResponse(rpcError(-32_700, 'parse error'), 400)
    }
    const parsedBody = parsed.success

    // One handler per request is the documented usage for ordinary tools and
    // resources; the factory closes over this request's verified token so
    // every tool lands in the right workspace.
    const handle = createMcpHandler(
      () => buildMcpServer(env, verified.scopes, verified.workspaceSlug),
      {
        corsOptions: false,
        // Bearer-token auth already ran upstream; nothing for CORS to add.
        // Strict stateless-only: legacy-protocol clients are rejected rather
        // than served through the v1 compatibility fallback.
        legacy: 'reject'
      }
    )
    // The router hands us its own request type with a relative URL; rebuild
    // the standard fetch Request the Agents handler expects, restoring the
    // absolute URL from the Host header and forwarding the reserved modern-
    // era headers (`Mcp-Method`, `Mcp-Name`, `MCP-Protocol-Version`) the
    // handler cross-checks against the body.
    const host = request.headers['host'] ?? 'localhost'
    const targetUrl = new URL(request.url, `https://${host}`).toString()
    const modernHeaders: Record<string, string> = {}
    for (const name of ['mcp-method', 'mcp-name', 'mcp-protocol-version']) {
      const value = request.headers[name]
      if (value !== undefined) modernHeaders[name] = value
    }
    const webRequest = new Request(targetUrl, {
      method: 'POST',
      headers: {
        host,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...modernHeaders
      },
      body: raw.success
    })
    const response = yield* Effect.promise(() =>
      handle.fetch(webRequest, { parsedBody })
    )
    return fromWeb(response)
  })
}

// Requirements beyond `HttpRouter` (token registry, rate limiter) are provided
// by the same capability layer the contract groups ride on — see `http.ts`.
export function mcpProtocolLayer(env: ApiEnv) {
  return HttpRouter.add('POST', '/mcp', (request) =>
    Effect.map(
      Effect.result(
        observed(env, request, 'mcp.protocol', {}, protocolBody(env, request))
      ),
      (outcome): HttpServerResponse.HttpServerResponse => {
        if (Result.isFailure(outcome)) return failureResponse(outcome.failure)
        return outcome.success
      }
    )
  )
}
