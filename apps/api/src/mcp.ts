import { McpServer } from '@modelcontextprotocol/server'
import { type JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { tokenPrincipal, type PermissionRequest } from '@b2b-saas-starter/authz/client'
import { requirePermission } from '@b2b-saas-starter/authz/guard'
import {
  READ_OPERATIONS,
  readOperations,
  serveRead,
  type CapabilityRead,
  type CapabilityReadError
} from './operations.ts'
import {
  statusForTag,
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
import { type ApiTokenScope } from '@b2b-saas-starter/authz/roles'
import { createMcpHandler } from 'agents/mcp/server'
import { z } from 'zod'

import { type AuthorizationDenied } from '@b2b-saas-starter/authz/errors'
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

/**
 * The advertised tools — derived from the shared operation table
 * (operations.ts) rather than hand-mirrored: each tool is exactly one REST
 * workspace read, with the same permission and the same capability read.
 * Every tool is a read over a surviving capability — MCP exposes what REST
 * exposes, nothing resurrected. The mirrored operation is named on the wire
 * so a tool's description points at its REST twin.
 */
type ToolDefinition = {
  readonly descriptor: McpToolDescriptor
  readonly permission: PermissionRequest
  readonly capability: () => CapabilityRead
}

export const mcpTools: readonly ToolDefinition[] = readOperations().map(
  (operation) => ({
    descriptor: {
      name: operation.toolName,
      description: `${operation.toolDescription} Mirrors GET /workspaces/{slug}/${operation.path}.`,
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    },
    permission: operation.permission,
    capability: operation.read
  })
)

/** What `GET /mcp` advertises — derived from the same table `tools/list` serves. */
export function mcpDiscoveryDocument(): McpDiscovery {
  return {
    name: MCP_SERVER_NAME,
    resources: [OVERVIEW_RESOURCE_URI],
    tools: mcpTools.map((tool) => tool.descriptor)
  }
}

type ToolResult = {
  content: [{ type: 'text'; text: string }]
  isError?: boolean
}

/**
 * Generic failure body shared by both promise seams (typed-failure fallthrough
 * and defect rejection); internals never leak into the client's transcript.
 */
export const TOOL_FAILED_MESSAGE = 'tool failed; see the API worker logs'

/** What a settled tool invocation hands the wire encoder. */
type ToolOutcome = Result.Result<unknown, CapabilityReadError>

// The JSON-RPC wire format carries opaque JSON payloads; serializing the
// already-typed capability results here IS the encoding step.
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- `unknown` is the protocol's own payload type; the capability layer already produced it
function textResult(data: unknown): ToolResult {
  return {
    // oxlint-disable-next-line effect/noGlobals -- see above: this is the wire encoding
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
  }
}

function errorResult(outcome: ToolOutcome): ToolResult {
  if (Result.isFailure(outcome)) {
    // Exhaustive over the known typed failures; anything else falls through to
    // the generic body so internals never leak into the client's transcript.
    switch (outcome.failure._tag) {
      case 'AuthorizationDenied': {
        return {
          content: [{ type: 'text', text: `denied: ${outcome.failure.reason}` }],
          isError: true
        }
      }
      case 'CapabilityUnavailable': {
        return {
          content: [
            { type: 'text', text: 'capability unavailable in this environment' }
          ],
          isError: true
        }
      }
      case 'WorkspaceNotFound': {
        return {
          content: [{ type: 'text', text: 'workspace not found' }],
          isError: true
        }
      }
    }
  }
  return {
    content: [{ type: 'text', text: TOOL_FAILED_MESSAGE }],
    isError: true
  }
}

function outcomeToToolResult(outcome: ToolOutcome): ToolResult {
  if (Result.isSuccess(outcome)) return textResult(outcome.success)
  return errorResult(outcome)
}

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

        // `Effect.result` moves the typed error channel into the value before
        // the promise seam, so classification stays compiler-checked. The
        // rejection handler only sees defects — never a typed failure.
        return Effect.runPromise(
          provideWorkspace(env, workspaceSlug, Effect.result(guarded))
        ).then(outcomeToToolResult, () => ({
          content: [{ type: 'text', text: TOOL_FAILED_MESSAGE }],
          isError: true
        }))
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
      // The resource projects the same overview read the REST route and the
      // tools serve — pulled from the shared operation table like both of
      // them, through the one sanctioned channel widening (`serveRead`).
      const overview = serveRead(READ_OPERATIONS.overview)
      const guarded = Effect.map(overview, (value) => ({
        contents: [
          {
            uri: OVERVIEW_RESOURCE_URI,
            // oxlint-disable-next-line effect/noGlobals -- MCP resource contents are JSON text by protocol definition
            text: JSON.stringify(value, null, 2),
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

/** Maps guard failures to HTTP statuses via the contract's canonical table. */
function failureResponse(
  error: ProtocolFailure
): HttpServerResponse.HttpServerResponse {
  return jsonResponse({ _tag: error._tag }, statusForTag(error._tag))
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
      // oxlint-disable-next-line effect/noGlobals -- the Agents SDK validates the forwarded body itself; this parse only turns bytes into objects at the promise seam
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
