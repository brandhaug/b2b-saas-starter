import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  type Transport,
  type TransportSendOptions
} from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  type JSONRPCMessage,
  type MessageExtraInfo,
  LATEST_PROTOCOL_VERSION
} from '@modelcontextprotocol/sdk/types.js'
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
import { Effect, Result, Schema } from 'effect'
import { type ApiTokenScope } from '@b2b-saas-starter/authz/src/roles.ts'
import { type WorkspaceContext } from '@b2b-saas-starter/capabilities/src/workspace-context.ts'

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
 * `POST /mcp`, built on the official TypeScript SDK
 * (`@modelcontextprotocol/sdk`). The protocol route sits outside the
 * `StarterApi` contract on purpose — JSON-RPC over streamable HTTP is its own
 * wire shape, not a REST operation — so it never appears in the OpenAPI
 * document or the permission matrix. It shares everything that matters with
 * the REST groups: one bearer-token authentication path (`authenticate`), the
 * same `requirePermission` guard per tool, the same `mcp` rate-limit bucket,
 * and the same capability services underneath.
 *
 * Each request is handled statelessly: a fresh `McpServer` instance answers a
 * single JSON-RPC message over an in-memory transport and is discarded. That
 * keeps the Worker free of session state (no Durable Object — ADR 0009),
 * which stock clients handle: they initialize per connection, and every call
 * carries the bearer token that scopes it to one workspace.
 *
 * `GET /mcp` remains the REST discovery document served by the contract group;
 * it advertises exactly what this module registers.
 *
 * The SDK is Promise-native while this worker is Effect-first. The seam is the
 * transport (`SingleMessageTransport`) and the two dispatch helpers: everything
 * below them stays in Effect, everything above them is SDK-owned code. The
 * lint suppressions in that section mark the boundary itself, matching how the
 * web bindings treat Better Auth ports.
 */

export const MCP_SERVER_NAME = 'b2b-saas-starter-mcp'
const OVERVIEW_RESOURCE_URI = 'workspace://overview'

const EMPTY_OBJECT_SCHEMA = {
  type: 'object',
  properties: {},
  additionalProperties: false
}

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
      inputSchema: EMPTY_OBJECT_SCHEMA
    },
    permission: { notification: ['read'] },
    capability: () => Effect.flatMap(NotificationFeed, (feed) => feed.list)
  },
  {
    descriptor: {
      name: 'get_workspace_overview',
      description:
        'The workspace record plus its notification feed, mirroring GET /workspaces/{slug}/overview.',
      inputSchema: EMPTY_OBJECT_SCHEMA
    },
    permission: { notification: ['read'] },
    capability: () => workspaceOverview
  },
  {
    descriptor: {
      name: 'list_members',
      description:
        'List the workspace members and their roles, mirroring GET /workspaces/{slug}/members.',
      inputSchema: EMPTY_OBJECT_SCHEMA
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
      inputSchema: EMPTY_OBJECT_SCHEMA
    },
    permission: { apiToken: ['list'] },
    capability: () => Effect.flatMap(ApiTokenRegistry, (tokens) => tokens.list)
  },
  {
    descriptor: {
      name: 'list_webhooks',
      description:
        'List registered webhook endpoints and their success rates, mirroring GET /workspaces/{slug}/webhooks.',
      inputSchema: EMPTY_OBJECT_SCHEMA
    },
    permission: { webhook: ['list'] },
    capability: () => Effect.flatMap(WebhookEndpoints, (webhooks) => webhooks.list)
  },
  {
    descriptor: {
      name: 'list_audit_events',
      description:
        'Read a page of the workspace audit trail, mirroring GET /workspaces/{slug}/audit-events.',
      inputSchema: EMPTY_OBJECT_SCHEMA
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
// oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, effect/noAs, effect/noTernary, anti-slop/require-safety-comment-for-type-assertion -- this block classifies untyped Effect errors crossing the SDK's promise seam; the tag check IS the contract

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
        inputSchema: {}
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

/**
 * An in-memory transport carrying client messages in and capturing the
 * server's replies. This is the whole fetch-to-SDK bridge: the official
 * `McpServer` speaks the protocol; this class only moves bytes between it and
 * the Workers `Request`/`Response` pair. Its Promise-shaped API is dictated by
 * the SDK's `Transport` interface, not chosen.
 */

// oxlint-disable effect/noNewPromise -- the SDK's Transport interface is promise-typed; these methods adapt to it
class SingleMessageTransport implements Transport {
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the signature must mirror the SDK's generic Transport.onmessage
  onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void

  onclose?: () => void
  onerror?: (error: Error) => void

  private readonly replies: JSONRPCMessage[] = []
  private readonly waiting: ((message: JSONRPCMessage) => void)[] = []

  start(): Promise<void> {
    return Promise.resolve()
  }

  send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    if ('id' in message && message.id !== undefined) {
      const waiting = this.waiting.shift()
      if (waiting === undefined) {
        this.replies.push(message)
      } else {
        waiting(message)
      }
    }
    // Server-initiated notifications have nowhere to go in stateless mode.
    return Promise.resolve()
  }

  close(): Promise<void> {
    this.onclose?.()
    return Promise.resolve()
  }

  /** Simulates the client's message arriving on the wire. */
  receive(message: JSONRPCMessage): void {
    this.onmessage?.(message)
  }

  /** Resolves with the server's next JSON-RPC response, in send order. */
  nextReply(): Promise<JSONRPCMessage> {
    const queued = this.replies.shift()
    if (queued !== undefined) return Promise.resolve(queued)
    return new Promise<JSONRPCMessage>((resolve) => {
      this.waiting.push(resolve)
    })
  }
}
// oxlint-enable effect/noNewPromise

const DISPATCH_TIMEOUT_MS = 30_000

// Statelessness shim: every HTTP request gets a fresh server instance, so a
// `tools/list` or `tools/call` would be refused with "not initialized" unless
// this bridge performs the handshake first. Stock clients never see these two
// synthetic messages — they exist inside one request's lifetime only.
const SYNTHETIC_CLIENT_INFO = { name: `${MCP_SERVER_NAME}-bridge`, version: '0.0.0' }

function isInitialize(message: JSONRPCMessage): boolean {
  return 'method' in message && message.method === 'initialize'
}

/**
 * Feeds one JSON-RPC request to a fresh server instance and resolves the
 * reply, performing the synthetic handshake first when the message itself is
 * not the `initialize`. Returns `undefined` if the reply timed out.
 */

// oxlint-disable effect/noAsyncFunction, effect/noTryCatch, effect/noNewPromise, effect/noGlobals -- the SDK connect/dispose cycle is promise-based and wall-clock timed; this function is the bridge across it
async function dispatchMessage(
  env: ApiEnv,
  scopes: readonly ApiTokenScope[],
  workspaceSlug: string,
  message: JSONRPCMessage
): Promise<JSONRPCMessage | undefined> {
  const transport = new SingleMessageTransport()
  const server = buildMcpServer(env, scopes, workspaceSlug)
  try {
    await server.connect(transport)
    if (!isInitialize(message)) {
      transport.receive({
        jsonrpc: '2.0',
        id: '__handshake',
        method: 'initialize',
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: SYNTHETIC_CLIENT_INFO
        }
      })
      await transport.nextReply()
      transport.receive({ jsonrpc: '2.0', method: 'notifications/initialized' })
    }
    transport.receive(message)
    // Notifications get no reply: feeding them keeps protocol state
    // consistent, then the dispatch ends immediately.
    if (!('id' in message)) return undefined
    return await Promise.race([
      transport.nextReply(),
      new Promise<undefined>((resolve) => {
        setTimeout(() => resolve(undefined), DISPATCH_TIMEOUT_MS)
      })
    ])
  } finally {
    await server.close()
  }
}
// oxlint-enable effect/noAsyncFunction, effect/noTryCatch

// The guard errors, passed straight through — same tags, same statuses as the
// contract groups.
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

function isNotification(message: JSONRPCMessage): boolean {
  return !('id' in message)
}

/**
 * The JSON-RPC wire contract for messages a client may POST here, decoded with
 * Schema so the raw body never enters the handler untyped.
 */
const IncomingJsonRpc = Schema.Union([
  Schema.Struct({
    jsonrpc: Schema.Literal('2.0'),
    id: Schema.NullOr(Schema.Union([Schema.Number, Schema.String])),
    method: Schema.String
  }),
  Schema.Struct({
    jsonrpc: Schema.Literal('2.0'),
    method: Schema.String
  })
])
const IncomingJsonRpcFromString = Schema.fromJsonString(IncomingJsonRpc)
const decodeIncoming = Schema.decodeUnknownSync(IncomingJsonRpcFromString)

/**
 * The `POST /mcp` handler: rate-limit, authenticate, prove `mcp:read`, then
 * hand the JSON-RPC message to the SDK server. Guard failures escape the body
 * so `observed` records them like any other rejected request; everything else
 * answers inline per the streamable-HTTP rules (202 for notifications, JSON-RPC
 * error bodies for malformed traffic).
 */
function protocolBody(env: ApiEnv, request: HttpServerRequest.HttpServerRequest) {
  const parseError = jsonResponse(rpcError(-32_700, 'parse error'), 400)
  return Effect.gen(function* () {
    yield* enforceRateLimit(request, 'mcp')
    const verified = yield* authenticate(request)
    // `observed` supplies the request Scope that `requirePermission` needs.
    yield* requirePermission(tokenPrincipal(verified.scopes), { mcp: ['read'] })

    const raw = yield* Effect.result(request.text)
    if (Result.isFailure(raw)) {
      return parseError
    }
    // Validate the envelope with Schema, then hand the SDK the parsed body
    // verbatim — request params are re-validated by the SDK per method, and
    // stripping them here would corrupt the forwarded message.
    const checked = yield* Effect.result(Effect.try(() => decodeIncoming(raw.success)))
    if (Result.isFailure(checked)) {
      return parseError
    }
    const message = yield* Effect.result(
      Effect.try((): JSONRPCMessage => {
        // oxlint-disable-next-line effect/noGlobals -- the SDK validates the forwarded body itself; this parse only turns bytes into objects
        return JSON.parse(raw.success)
      })
    )
    if (Result.isFailure(message)) {
      return parseError
    }

    if (isNotification(message.success)) {
      yield* Effect.promise(() =>
        dispatchMessage(env, verified.scopes, verified.workspaceSlug, message.success)
      )
      return HttpServerResponse.empty({ status: 202 })
    }

    const reply = yield* Effect.promise(() =>
      dispatchMessage(env, verified.scopes, verified.workspaceSlug, message.success)
    )
    if (reply === undefined) {
      return jsonResponse(rpcError(-32_000, 'server timed out'), 504)
    }
    return jsonResponse(reply, 200)
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
