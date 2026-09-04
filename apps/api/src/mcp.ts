import { McpServer } from '@modelcontextprotocol/server'
import { type JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import {
  memberPrincipal,
  tokenPrincipal,
  type Principal
} from '@b2b-saas-starter/authz/client'
import { requirePermission } from '@b2b-saas-starter/authz/guard'
import {
  mirroredRestPath,
  READ_OPERATIONS,
  readOperations,
  type CapabilityReadError,
  type CapabilityReadServices,
  type WorkspaceReadOperation
} from './operations.ts'
import { guardFailureResponse, type GuardFailure } from '@b2b-saas-starter/api/errors'
import { type McpDiscovery, type McpToolDescriptor } from '@b2b-saas-starter/api'
import {
  HttpRouter,
  HttpServerResponse,
  type HttpServerRequest
} from 'effect/unstable/http'
import { type Context, Effect, Result } from 'effect'
import { createMcpHandler } from 'agents/mcp/server'
import { z } from 'zod'

import { WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'

import {
  authenticateMcpCaller,
  enforceRateLimit,
  mcpCallerActor,
  mcpCallerWorkspaceSlug,
  observed,
  provideWorkspace,
  webRequest,
  type McpCaller
} from './request-guards.ts'
import { type ApiEnv } from './env.ts'
import { oauthChallengeHeader, oauthResourceConfig } from './oauth-access-token.ts'

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
 * shares everything that matters with the REST groups: the bearer-token
 * verification path, the same `requirePermission` guard
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
 *
 * Two credentials open the route (ADR 0068): a workspace API Token, or an
 * OAuth access token the web worker minted for a signed-in Member after the
 * consent page bound it to one workspace. `authenticateMcpCaller` tells them
 * apart; from there the only difference is who a tool authorizes as — the
 * token's scopes, or the Member's role in the workspace, re-resolved from the
 * membership table on every call.
 */

export const MCP_SERVER_NAME = 'b2b-saas-starter-mcp'
const OVERVIEW_RESOURCE_URI = 'workspace://overview'

/**
 * Every tool reads like its REST mirror: paged list tools take the same
 * optional `cursor`/`limit` the REST route accepts (ADR 0057), the one
 * parameterized read (deliveries for one endpoint) takes exactly that path
 * parameter, and the overview resource takes no input. The zod schema is what
 * the MCP SDK registers with, and the JSON Schema `GET /mcp` advertises is
 * generated from it — minus the `$schema` dialect header, which a tool
 * descriptor's `inputSchema` has no use for — so an operation's input is
 * declared once.
 */
const NO_TOOL_INPUT = z.object({})
/**
 * The paging input every list tool takes — the same optional `cursor`/`limit`
 * the REST route accepts (ADR 0057), whose contract-side owner is
 * `ListPageQuery` in `@b2b-saas-starter/api`. Known behavioral divergence,
 * documented on both declarations: REST's Effect-v4 query codec treats an
 * undecodable optional as absent — `?limit=abc` decodes the field away and
 * the read serves the default page — while this zod schema rejects a
 * non-numeric `limit` with a tool-call error. Same vocabulary, one edge case
 * apart; deriving one schema system from the other is not worth the bridge.
 * Exported so `mcp.test.ts` can pin the advertised shape against drift.
 */
export const PAGED_TOOL_INPUT = z.object({
  cursor: z.string().optional(),
  limit: z.number().optional()
})
const ENDPOINT_ID_TOOL_INPUT = z.object({
  endpointId: z.string().describe('The webhook endpoint id whose deliveries to list.')
})

/**
 * The advertised JSON Schema for a registered input: `z.toJSONSchema` with the
 * `$schema` dialect header dropped, which a tool descriptor's `inputSchema`
 * has no use for.
 */
function advertisedInputSchema(schema: z.ZodObject) {
  const jsonSchema = z.toJSONSchema(schema)
  // oxlint-disable-next-line eslint/no-unused-vars -- destructured to drop the dialect header
  const { $schema: _dialect, ...rest } = jsonSchema
  return rest
}

const NO_TOOL_INPUT_SCHEMA = advertisedInputSchema(NO_TOOL_INPUT)
const ENDPOINT_ID_INPUT_SCHEMA = advertisedInputSchema(ENDPOINT_ID_TOOL_INPUT)

/**
 * The two tool input shapes, keyed by the row's discrimination: the registered
 * zod schema (what the SDK validates against) and the advertised JSON Schema
 * (`GET /mcp`) stay in one entry, so they cannot drift apart.
 */
const TOOL_INPUTS = {
  collection: { zod: NO_TOOL_INPUT, schema: NO_TOOL_INPUT_SCHEMA },
  paged: { zod: PAGED_TOOL_INPUT, schema: advertisedInputSchema(PAGED_TOOL_INPUT) },
  endpointId: { zod: ENDPOINT_ID_TOOL_INPUT, schema: ENDPOINT_ID_INPUT_SCHEMA }
}

/** The input entry an operation registers with, derived from its row shape. */
function toolInput(operation: WorkspaceReadOperation) {
  if (operation.param !== undefined) {
    return TOOL_INPUTS.endpointId
  }
  if (operation.paged) {
    return TOOL_INPUTS.paged
  }
  return TOOL_INPUTS.collection
}

/**
 * One tool descriptor, projected from one row of the shared operation table
 * (operations.ts) rather than hand-mirrored: same name, same permission, same
 * capability read as the REST endpoint it names. Every tool is a read over a
 * surviving capability — MCP exposes what REST exposes, nothing resurrected.
 */
function toolDescriptor(operation: WorkspaceReadOperation): McpToolDescriptor {
  return {
    name: operation.toolName,
    description: `${operation.toolDescription} Mirrors GET /${mirroredRestPath(operation.path)}.`,
    inputSchema: toolInput(operation).schema
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
 * Who a tool authorizes as. An API Token is its scopes. An OAuth caller is the
 * Member the workspace layer just resolved — from the membership table, not
 * from the token's role claim — so a member removed since consenting is
 * refused with `WorkspaceNotFound` while the layer builds, and a role change
 * applies on the next call. (The `ctx.actor === null` half is the context
 * type's honesty: this route always builds the layer with the caller's
 * `ActorRef`, so the null case is not reachable here.)
 */
function callerPrincipal(
  caller: McpCaller
): Effect.Effect<Principal | null, never, WorkspaceContext> {
  if (caller.kind === 'token') {
    return Effect.succeed(tokenPrincipal(caller.token.scopes))
  }
  return Effect.map(WorkspaceContext, (ctx) => {
    if (ctx.actor === null) {
      return null
    }
    return memberPrincipal(ctx.actor.role)
  })
}

/**
 * Builds one stateless server instance for a single request, bound to the
 * caller's workspace. Every invocation re-checks its own permission first —
 * the route gate only proved `mcp:read`; a tool must never serve data its
 * REST counterpart would deny.
 *
 * Tool callbacks are the one place this worker leaves Effect-land: the SDK
 * invokes plain async functions, so each callback bridges back onto the
 * request-scoped workspace layer with `Effect.runPromise`.
 */
function buildMcpServer(
  env: ApiEnv,
  caller: McpCaller,
  services: Context.Context<CapabilityReadServices>
): McpServer {
  /**
   * The request's services behind one read: the workspace layer resolves this
   * call's tenant (and, for an OAuth caller, proves the Member still belongs
   * to it), and the capability services come from the context the route
   * captured — the isolate's, not a fresh graph per tool call. Returns the
   * Effect; each seam runs it the way it needs.
   */
  function bridged<A>(
    body: Effect.Effect<
      A,
      CapabilityReadError,
      CapabilityReadServices | WorkspaceContext
    >
  ): Effect.Effect<A, CapabilityReadError, never> {
    return Effect.provideContext(
      provideWorkspace(
        env,
        mcpCallerWorkspaceSlug(caller),
        body,
        mcpCallerActor(caller)
      ),
      services
    )
  }

  /**
   * The tool seam: `Effect.result` sits OUTSIDE the workspace layer, so a slug
   * the layer cannot resolve — or a caller who is no longer a member — fails
   * while the layer builds, and that failure reaches the classifier as the
   * typed `WorkspaceNotFound` it is, not as a defect at the promise seam.
   */
  function runRead<A>(
    body: Effect.Effect<
      A,
      CapabilityReadError,
      CapabilityReadServices | WorkspaceContext
    >
  ): Promise<Result.Result<A, CapabilityReadError>> {
    return Effect.runPromise(Effect.result(bridged(body)))
  }

  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: '0.1.0' },
    { capabilities: { tools: {}, resources: {} } }
  )

  for (const operation of readOperations()) {
    const descriptor = toolDescriptor(operation)
    server.registerTool(
      descriptor.name,
      {
        title: descriptor.name,
        description: descriptor.description,
        inputSchema: toolInput(operation).zod
      },
      (args) => {
        // One guard + one capability read, bridged onto the request-scoped
        // workspace layer. `requirePermission` needs a Scope, which only exists
        // inside the Effect runtime, hence the scoped wrapper here rather than
        // in the capability itself. The paging input rides to the same read
        // the REST route serves — the two surfaces page identically.
        const guarded = Effect.gen(function* () {
          yield* requirePermission(yield* callerPrincipal(caller), operation.permission)
          // The SDK validated `args` against the registered schema before
          // invoking, so the parse is total. Paged collection reads carry the
          // same paging input REST serves; the one parameterized read gets
          // exactly its path argument.
          if (operation.param === undefined) {
            return yield* operation.read(PAGED_TOOL_INPUT.parse(args))
          }
          return yield* operation.read(undefined, ENDPOINT_ID_TOOL_INPUT.parse(args))
        }).pipe(Effect.scoped)

        // `runRead` moves the typed error channel into the value before the
        // promise seam, so classification stays compiler-checked. The
        // rejection handler only sees defects — never a typed failure.
        return runRead(guarded).then(outcomeToToolResult, () => ({
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
      description: "The caller's workspace record with its notification feed, as JSON."
    },
    () => {
      // The resource projects the same overview read the REST route and the
      // tools serve, pulled from the shared operation table like both of them.
      // The SDK's resource callback has no typed-error channel of its own, so
      // the effect's failure rejects the raw promise seam (`bridge`, not
      // `runRead`) and the protocol answers with its own internal error.
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
      return Effect.runPromise(bridged(guarded))
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
function failureResponse(
  env: ApiEnv,
  request: HttpServerRequest.HttpServerRequest,
  error: GuardFailure
): HttpServerResponse.HttpServerResponse {
  const { status, body } = guardFailureResponse(error)
  // RFC 9728: a 401 tells an OAuth-capable client where the protected-resource
  // metadata is, which is how Claude finds the authorization server. Only
  // when OAuth is configured — otherwise there is nothing to discover.
  if (error._tag === 'Unauthorized' && oauthResourceConfig(env) !== undefined) {
    const origin = new URL(webRequest(request).url).origin
    return HttpServerResponse.jsonUnsafe(body, {
      status,
      headers: { 'www-authenticate': oauthChallengeHeader(origin) }
    })
  }
  return HttpServerResponse.jsonUnsafe(body, { status })
}

/**
 * The `POST /mcp` handler: rate-limit, authenticate (API Token or OAuth access
 * token), then hand the request to the Agents SDK handler. Guard failures
 * escape the body so `observed` records them like any other rejected request;
 * everything past the gate — parsing included — is the Agents handler's job,
 * fed the pre-parsed body through `fetch(request, { parsedBody })`.
 *
 * There is deliberately no route-level permission check beside authentication:
 * every credential the system can mint already clears `mcp:read` (the read and
 * write token scopes carry it, and the OAuth verifier refuses a token without
 * it), so a gate here could never deny. The real enforcement is per tool —
 * each invocation re-checks its own `operation.permission`, the same
 * permission its REST counterpart demands.
 */
function protocolBody(env: ApiEnv, request: HttpServerRequest.HttpServerRequest) {
  return Effect.gen(function* () {
    yield* enforceRateLimit(request, 'mcp')
    const caller = yield* authenticateMcpCaller(request)

    // The router's request wraps the Worker's own fetch `Request`, and
    // `webRequest` hands it straight back — absolute URL, original headers,
    // body untouched. There is no transport to hand-roll: the conversion is
    // the platform's, with the guard's own fallback for an underivable URL.
    const web = webRequest(request)

    // Read the body off a clone so the forwarded request still carries it.
    // The Agents handler validates the message itself; this parse only turns
    // bytes into the object handed to `fetch(request, { parsedBody })`.
    const parsed = yield* Effect.result(
      Effect.tryPromise((): Promise<JSONRPCMessage> => web.clone().json())
    )
    if (Result.isFailure(parsed)) {
      return rpcErrorResponse(-32_700, 'parse error', 400)
    }

    // One handler per request is the documented usage for ordinary tools and
    // resources; the factory closes over this request's verified caller so
    // every tool lands in the right workspace.
    // The capability services are built once per isolate and provided to this
    // request by `http.ts`; capturing them here carries them across the SDK's
    // promise seam instead of rebuilding the graph inside every tool call.
    const services = yield* Effect.context<CapabilityReadServices>()
    const handle = createMcpHandler(() => buildMcpServer(env, caller, services), {
      corsOptions: false,
      // Bearer-token auth already ran upstream; nothing for CORS to add.
      // Strict stateless-only: legacy-protocol clients are rejected rather
      // than served through the v1 compatibility fallback.
      legacy: 'reject'
    })
    // The one header a stock streamable-HTTP client always sends that a caller
    // here may omit: the handler negotiates its response body against
    // `accept`, and refuses the request without it.
    const headers = new Headers(web.headers)
    headers.set('accept', 'application/json, text/event-stream')
    const response = yield* Effect.promise(() =>
      handle.fetch(new Request(web, { headers }), {
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
          return failureResponse(env, request, outcome.failure)
        }
        return outcome.success
      }
    )
  )
}
