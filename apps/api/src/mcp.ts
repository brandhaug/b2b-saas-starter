import { McpServer } from '@modelcontextprotocol/server'
import { type JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { tokenPrincipal, type ApiTokenScope } from '@b2b-saas-starter/authz/client'
import { requirePermission } from '@b2b-saas-starter/authz/guard'
import {
  READ_OPERATIONS,
  readOperations,
  type CapabilityReadError,
  type CapabilityReadServices,
  type WorkspaceReadOperation
} from './operations.ts'
import {
  guardFailureResponse,
  type GuardFailure,
  type McpDiscovery,
  type McpToolDescriptor
} from '@b2b-saas-starter/api'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'
import { type Context, Effect, Result } from 'effect'
import { createMcpHandler } from 'agents/mcp/server'
import { z } from 'zod'

import { type WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'

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
 * workspace so every tool reads from the right tenant — and over the request's
 * already-built capability services, so a tool call resolves its workspace and
 * nothing else.
 *
 * `GET /mcp` remains the REST discovery document served by the contract group;
 * it advertises exactly what this module registers.
 */

export const MCP_SERVER_NAME = 'b2b-saas-starter-mcp'
const OVERVIEW_RESOURCE_URI = 'workspace://overview'

/**
 * Every tool's arguments mirror its REST counterpart's query: the five list
 * tools take the same optional `cursor`/`limit` the REST route accepts
 * (ADR 0054) and the overview resource takes none. Out-of-range limits are
 * clamped by the capability layer, exactly as REST clamps them — the wire
 * schema stays permissive so MCP and REST cannot disagree about what a valid
 * page request is. The zod schema is what the MCP SDK registers with, and the
 * JSON Schema `GET /mcp` advertises is generated from it — minus the
 * `$schema` dialect header, which a tool descriptor's `inputSchema` has no
 * use for.
 */
const NO_TOOL_INPUT = z.object({})
const PAGED_TOOL_INPUT = z.object({
  cursor: z.string().optional(),
  limit: z.number().optional()
})
type ToolInput = z.infer<typeof PAGED_TOOL_INPUT>
// oxlint-disable-next-line eslint/no-unused-vars -- destructured to drop the dialect header from the advertised schema
const { $schema: _dialect, ...NO_TOOL_INPUT_SCHEMA } = z.toJSONSchema(NO_TOOL_INPUT)
// oxlint-disable-next-line eslint/no-unused-vars -- destructured to drop the dialect header from the advertised schema
const { $schema: _dialectPaged, ...PAGED_TOOL_INPUT_SCHEMA } =
  z.toJSONSchema(PAGED_TOOL_INPUT)

/**
 * One tool descriptor, projected from one row of the shared operation table
 * (operations.ts) rather than hand-mirrored: same name, same permission, same
 * capability read as the REST endpoint it names — and, for lists, the same
 * paging input. Every tool is a read over a surviving capability — MCP
 * exposes what REST exposes, nothing resurrected.
 */
function toolDescriptor(operation: WorkspaceReadOperation): McpToolDescriptor {
  let inputSchema = NO_TOOL_INPUT_SCHEMA
  if (operation.paged) {
    inputSchema = PAGED_TOOL_INPUT_SCHEMA
  }
  return {
    name: operation.toolName,
    description: `${operation.toolDescription} Mirrors GET /workspaces/{slug}/${operation.path}.`,
    inputSchema
  }
}

/** What `GET /mcp` advertises — the same rows `tools/list` is registered from. */
export function mcpDiscoveryDocument(): McpDiscovery {
  return {
    name: MCP_SERVER_NAME,
    resources: [OVERVIEW_RESOURCE_URI],
    tools: readOperations().map(toolDescriptor)
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
  if (Result.isSuccess(outcome)) {
    return textResult(outcome.success)
  }
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
  scopes: ReadonlyArray<ApiTokenScope>,
  workspaceSlug: string,
  services: Context.Context<CapabilityReadServices>
): McpServer {
  /**
   * Bridges one tool/resource read onto the request's services: the workspace
   * layer resolves this call's tenant, and the capability services come from
   * the context the route captured — the isolate's, not a fresh graph per tool
   * call.
   */
  function runRead<A>(
    body: Effect.Effect<
      A,
      CapabilityReadError,
      CapabilityReadServices | WorkspaceContext
    >
  ): Promise<A> {
    return Effect.runPromise(
      Effect.provideContext(provideWorkspace(env, workspaceSlug, body), services)
    )
  }

  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: '0.1.0' },
    { capabilities: { tools: {}, resources: {} } }
  )

  for (const operation of readOperations()) {
    const descriptor = toolDescriptor(operation)
    let registeredInput = NO_TOOL_INPUT
    if (operation.paged) {
      registeredInput = PAGED_TOOL_INPUT
    }
    server.registerTool(
      descriptor.name,
      {
        title: descriptor.name,
        description: descriptor.description,
        inputSchema: registeredInput
      },
      (args: ToolInput) => {
        // One guard + one capability read, bridged onto the request-scoped
        // workspace layer. `requirePermission` needs a Scope, which only exists
        // inside the Effect runtime, hence the scoped wrapper here rather than
        // in the capability itself. The paging input rides to the same read
        // the REST route serves — the two surfaces page identically.
        const guarded = Effect.gen(function* () {
          yield* requirePermission(tokenPrincipal(scopes), operation.permission)
          return yield* operation.read(args)
        }).pipe(Effect.scoped)

        // `Effect.result` moves the typed error channel into the value before
        // the promise seam, so classification stays compiler-checked. The
        // rejection handler only sees defects — never a typed failure.
        return runRead(Effect.result(guarded)).then(outcomeToToolResult, () => ({
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
      // tools serve, pulled from the shared operation table like both of them.
      // The SDK's resource callback has no error shape of its own, so a typed
      // failure travels to the promise seam and rejects there — the protocol
      // answers with its own internal error.
      const guarded = Effect.map(READ_OPERATIONS.overview.read(), (value) => ({
        contents: [
          {
            uri: OVERVIEW_RESOURCE_URI,
            // oxlint-disable-next-line effect/noGlobals -- MCP resource contents are JSON text by protocol definition
            text: JSON.stringify(value, null, 2),
            mimeType: 'application/json'
          }
        ]
      }))
      return runRead(guarded)
    }
  )

  return server
}

function rpcErrorResponse(
  code: number,
  message: string,
  status: number
): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.jsonUnsafe(
    { jsonrpc: '2.0', id: null, error: { code, message } },
    { status }
  )
}

/**
 * A guard failure, encoded the way the contract encodes it: status and body
 * both come from the error schema's own annotations (`guardFailureResponse` in
 * `packages/api`), so a rejected `POST /mcp` answers exactly as a rejected REST
 * route would. Only the JSON-RPC bodies below are this route's own shape.
 */
function failureResponse(error: GuardFailure): HttpServerResponse.HttpServerResponse {
  const { status, body } = guardFailureResponse(error)
  return HttpServerResponse.jsonUnsafe(body, { status })
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

    // The router's request wraps the Worker's own fetch `Request`, so
    // `toWebResult` hands it straight back — absolute URL, original headers,
    // body untouched. There is no transport to hand-roll: the conversion is
    // the platform's. It fails only for a request with no derivable URL, which
    // is a malformed request, not a protocol-level one.
    const web = HttpServerRequest.toWebResult(request)
    if (Result.isFailure(web)) {
      return rpcErrorResponse(-32_600, 'invalid request', 400)
    }
    const webRequest = web.success

    // Read the body off a clone so the forwarded request still carries it.
    // The Agents handler validates the message itself; this parse only turns
    // bytes into the object handed to `fetch(request, { parsedBody })`.
    const parsed = yield* Effect.result(
      Effect.tryPromise((): Promise<JSONRPCMessage> => webRequest.clone().json())
    )
    if (Result.isFailure(parsed)) {
      return rpcErrorResponse(-32_700, 'parse error', 400)
    }

    // One handler per request is the documented usage for ordinary tools and
    // resources; the factory closes over this request's verified token so
    // every tool lands in the right workspace.
    // The capability services are built once per isolate and provided to this
    // request by `http.ts`; capturing them here carries them across the SDK's
    // promise seam instead of rebuilding the graph inside every tool call.
    const services = yield* Effect.context<CapabilityReadServices>()
    const handle = createMcpHandler(
      () => buildMcpServer(env, verified.scopes, verified.workspaceSlug, services),
      {
        corsOptions: false,
        // Bearer-token auth already ran upstream; nothing for CORS to add.
        // Strict stateless-only: legacy-protocol clients are rejected rather
        // than served through the v1 compatibility fallback.
        legacy: 'reject'
      }
    )
    // The one header a stock streamable-HTTP client always sends that a caller
    // here may omit: the handler negotiates its response body against
    // `accept`, and refuses the request without it.
    const headers = new Headers(webRequest.headers)
    headers.set('accept', 'application/json, text/event-stream')
    const response = yield* Effect.promise(() =>
      handle.fetch(new Request(webRequest, { headers }), {
        parsedBody: parsed.success
      })
    )
    return HttpServerResponse.fromWeb(response)
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
        if (Result.isFailure(outcome)) {
          return failureResponse(outcome.failure)
        }
        return outcome.success
      }
    )
  )
}
