import { NotificationFeed } from '@b2b-saas-starter/capabilities/notifications/notification-feed'
import { WorkspaceMembership } from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import { AuditEventLog } from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import { WebhookEndpoints } from '@b2b-saas-starter/capabilities/developer-platform/webhook-endpoints'
import {
  WorkspaceExports,
  type WorkspaceExportRecipient
} from '@b2b-saas-starter/capabilities/governance/workspace-export'
import { WorkspaceSuspensionService } from '@b2b-saas-starter/capabilities/governance/workspace-suspension'
import {
  StrongAuthentication,
  StrongAuthenticationRequired
} from '@b2b-saas-starter/capabilities/governance/strong-authentication'
import { McpClientConnections } from '@b2b-saas-starter/capabilities/developer-platform/mcp-client-connections'
import { mcpMutationOperations } from './mcp-mutations.ts'
import { clientKey } from '@b2b-saas-starter/rate-limit'
import {
  MCP_READ_SCOPE,
  MCP_WRITE_SCOPE
} from '@b2b-saas-starter/authz/mcp-access-token'
import {
  mirroredRestPath,
  READ_OPERATIONS,
  readOperations,
  OperationOrigin,
  OperationExportRecipient,
  OperationPrincipal,
  type CapabilityMutationError,
  type CapabilityMutationServices,
  type CapabilityRead,
  type CapabilityReadError,
  type CapabilityReadServices,
  type WorkspaceReadOperation
} from './operations.ts'
import {
  type RateLimited,
  type Unauthorized,
  guardFailureResponse,
  GuardFailure
} from '@b2b-saas-starter/api/errors'
import { RateLimiter, type McpDiscovery } from '@b2b-saas-starter/api'
import { Context, Effect, Layer, Result, Schema, SchemaIssue, type Types } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'
import {
  McpServer,
  layerHttp as mcpLayerHttp,
  registerResource
} from 'effect/unstable/ai/McpServer'
import { v2025_11_25 } from 'effect/unstable/ai/McpProtocol'
import {
  CallToolResult,
  InternalError,
  InvalidParams,
  Tool as McpTool,
  type ToolJsonSchema,
  ToolJsonSchema as ToolJsonSchemaCodec
} from 'effect/unstable/ai/McpSchema'

import { type WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'

import {
  authorizeMcpOperation,
  enforceRateLimitKey,
  bearerToken,
  verifyMcpCredential,
  enforceRateLimit,
  mcpCallerActor,
  mcpCallerActorType,
  observed,
  provideWorkspace,
  webRequest,
  type McpCaller
} from './request-guards.ts'
import { ApiTokenRegistry } from '@b2b-saas-starter/capabilities/developer-platform/api-token-registry'
import { type ApiEnv } from './env.ts'
import {
  OAuthTokenVerifier,
  oauthChallengeHeader,
  oauthResourceConfig
} from './oauth-access-token.ts'

/**
 * The MCP Capability Interface: a Model Context Protocol server served at
 * `/mcp` by Effect's own `McpServer` — `layerHttp` owns the streamable-HTTP
 * wire protocol end to end: content negotiation, the initialize handshake and
 * the session it mints (`mcp-session-id`), version headers, JSON-RPC parsing.
 * No hand-rolled transport, no third-party SDK.
 *
 * The protocol routes sit outside the `StarterApi` contract on purpose —
 * JSON-RPC over streamable HTTP is its own wire shape, not a REST operation —
 * so they never appear in the OpenAPI document or the permission matrix. They
 * share everything that matters with the REST groups: the same bearer-token
 * verification path (wrapped around the routes as router middleware, since
 * `layerHttp` owns the handlers), the same `requirePermission` guard per
 * tool, the same `mcp` rate-limit bucket, and the same capability services
 * underneath.
 *
 * The server, its tools, and the overview resource are built once per isolate
 * as layers; what varies per caller travels with the request. The gate
 * middleware verifies the credential and publishes it as `CurrentMcpCaller`,
 * and Effect's RPC plumbing merges the request fiber's context into every
 * tool invocation — so a tool call resolves its caller's workspace and
 * nothing else, the same per-request scoping the old per-request server
 * closures gave.
 *
 * `GET /mcp/discovery` remains the REST discovery document served by the
 * contract group; it advertises exactly what this module registers. (`GET
 * /mcp` itself is `layerHttp`'s: 405, no SSE stream to open.) The registered
 * tools project all supported workspace reads and mutations. ADR 0072 records
 * their authorization, typed input adapters, and side-effect annotations.
 *
 * Two credentials open the route (ADR 0068): a workspace API Token, or an
 * OAuth access token the web worker minted for a signed-in Member after the
 * consent page bound it to one workspace. `verifyMcpCredential` tells them
 * apart; from there the only difference is who a tool authorizes as — the
 * token's scopes, or the Member's role in the workspace, re-resolved from the
 * membership table on every call.
 */

export const MCP_SERVER_NAME = 'b2b-saas-starter-mcp'
const OVERVIEW_RESOURCE_URI = 'workspace://overview'

/**
 * The verified MCP caller for the request in flight. The gate middleware sets
 * it; tool and resource handlers read it. A reference, not a required
 * service, because the handlers are registered once per isolate while the
 * caller arrives per request — outside a gated request the default (no
 * caller) is the honest answer, and every handler turns it into an internal
 * error rather than a silent wrong-workspace read.
 */
export const CurrentMcpCaller = Context.Reference<McpCaller | undefined>(
  '@b2b-saas-starter/api/mcp/current-caller',
  { defaultValue: () => undefined }
)

/**
 * Every tool reads like its REST mirror: paged list tools take the same
 * optional `cursor`/`limit` the REST route accepts (ADR 0057), the one
 * parameterized read (deliveries for one endpoint) takes exactly that path
 * parameter, and the overview read takes no input. The Effect schema is what
 * a tool call decodes its arguments against, and the JSON Schema the
 * discovery document advertises is generated from it — so an operation's
 * input is declared once, in one schema system.
 *
 * The paging input every list tool takes: the same optional `cursor`/`limit`
 * the REST route accepts (ADR 0057), whose contract-side owner is
 * `ListPageQuery` in `@b2b-saas-starter/api`. Known behavioral divergence,
 * documented on both declarations: REST's query codec treats an undecodable
 * optional as absent — `?limit=abc` decodes the field away and the read
 * serves the default page — while this schema rejects a non-number `limit`
 * with an invalid-params tool-call error. Same vocabulary, one edge case
 * apart. Exported so `mcp.test.ts` can pin the advertised shape against
 * drift.
 */
export const PAGED_TOOL_INPUT = Schema.Struct({
  cursor: Schema.optionalKey(Schema.String),
  limit: Schema.optionalKey(Schema.Finite)
})
const ENDPOINT_ID_TOOL_INPUT = Schema.Struct({
  endpointId: Schema.String.pipe(
    Schema.annotate({
      description: 'The webhook endpoint id whose deliveries to list.'
    })
  )
})

/** The protocol's own check on what a tool descriptor may advertise. */
const decodeToolJsonSchema = Schema.decodeUnknownSync(ToolJsonSchemaCodec)

/**
 * The advertised JSON Schema for a registered input: the input schema run
 * through Effect's JSON Schema generator, decoded against the protocol's own
 * `ToolJsonSchema` so what ships is exactly what the protocol accepts. A
 * struct with no fields generates no object root, so the empty input
 * advertises the literal object shape.
 */
function advertisedInputSchema(schema: Schema.Constraint): ToolJsonSchema {
  return decodeToolJsonSchema(Schema.toJsonSchemaDocument(schema).schema)
}

const NO_TOOL_INPUT_SCHEMA: ToolJsonSchema = decodeToolJsonSchema({
  type: 'object',
  properties: {}
})
const PAGED_INPUT_SCHEMA = advertisedInputSchema(PAGED_TOOL_INPUT)
const DELIVERY_ID_TOOL_INPUT = Schema.Struct({ deliveryId: Schema.NonEmptyString })
const DELIVERY_ID_INPUT_SCHEMA = advertisedInputSchema(DELIVERY_ID_TOOL_INPUT)
const ENDPOINT_ID_INPUT_SCHEMA = advertisedInputSchema(ENDPOINT_ID_TOOL_INPUT)

/**
 * The advertised JSON Schema per row shape, keyed by the row's discrimination —
 * each generated from the schema a tool call decodes against (the same
 * declarations, right above), so the two cannot drift apart.
 */
const TOOL_INPUTS = {
  collection: NO_TOOL_INPUT_SCHEMA,
  paged: PAGED_INPUT_SCHEMA,
  deliveryId: DELIVERY_ID_INPUT_SCHEMA,
  endpointId: ENDPOINT_ID_INPUT_SCHEMA
}

/** The advertised input schema an operation registers with, derived from its row shape. */
function toolInput(operation: WorkspaceReadOperation): ToolJsonSchema {
  if (operation.param !== undefined) {
    return TOOL_INPUTS[operation.input]
  }
  if (operation.paged) {
    return TOOL_INPUTS.paged
  }
  return TOOL_INPUTS.collection
}

/**
 * One tool descriptor, projected from one row of the shared operation table
 * (operations.ts) rather than hand-mirrored: same name, same permission, same
 * capability read as the REST endpoint it names. Only rows that declare a
 * read projection reach here. Mutations use typed JSON adapters beside the
 * catalog and share the same capability dispatch (ADR 0072).
 */
function toolDescription(operation: WorkspaceReadOperation): string {
  return `${operation.toolDescription} Mirrors GET /${mirroredRestPath(operation.endpoint.path)}.`
}

/**
 * The one projection of a row onto the wire: name, description, and input
 * schema in a single place, so the discovery document (`GET /mcp/discovery`)
 * and the `McpTool` a call registers answer `tools/list` with the same
 * fields and cannot drift apart.
 */
function toolProjection(operation: WorkspaceReadOperation) {
  return {
    name: operation.toolName,
    description: toolDescription(operation),
    inputSchema: toolInput(operation)
  }
}

/** What `GET /mcp/discovery` advertises — the same rows tools are registered from. */
export function mcpDiscoveryDocument(): McpDiscovery {
  return {
    name: MCP_SERVER_NAME,
    resources: [OVERVIEW_RESOURCE_URI],
    tools: [
      ...readOperations().map(toolProjection),
      ...mcpMutationOperations().map((op) => ({
        name: op.toolName,
        description: `${op.toolDescription} Mirrors ${op.endpoint.method} /${mirroredRestPath(op.endpoint.path)}.`,
        inputSchema: mutationInputSchema(op.input)
      }))
    ]
  }
}

/**
 * Generic failure body shared by both defect seams (tool and resource);
 * internals never leak into the client's transcript.
 */
export const TOOL_FAILED_MESSAGE = 'tool failed; see the API worker logs'

/** What a settled tool invocation hands the wire encoder. */
type ToolFailure =
  | CapabilityReadError
  | CapabilityMutationError
  | RateLimited
  | Unauthorized
type ToolOutcome = Result.Result<unknown, ToolFailure>

// The JSON-RPC wire format carries opaque JSON payloads; serializing the
// already-typed capability results here IS the encoding step.
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- `unknown` is the protocol's own payload type; the capability layer already produced it
function textResult(data: unknown): CallToolResult {
  return new CallToolResult({
    // oxlint-disable-next-line effect/noGlobals -- see above: this is the wire encoding
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }]
  })
}

/**
 * The one text vocabulary for a typed capability failure. The tool channel
 * wraps it in an `isError` result and the resource channel in an internal
 * error, so both surfaces speak identically. The switch is exhaustive over
 * `CapabilityReadError`: a new variant is a compile error here until it gets
 * its text, never a silent generic body or a serialized failure object.
 */
function failureText(error: ToolFailure): string {
  switch (error._tag) {
    case 'WorkspaceSuspended': {
      return 'WorkspaceSuspended: workspace access is suspended. Contact a workspace owner or administrator.'
    }
    case 'AuthorizationDenied': {
      return `denied: ${error.reason}`
    }
    case 'StrongAuthenticationRequired': {
      return 'denied: strong_authentication_required'
    }
    case 'CapabilityUnavailable': {
      if (error.capability === 'webhook-publisher') {
        return 'webhook queue unavailable; a pending delivery may have been saved, but enqueue was not confirmed. Inspect deliveries before retrying'
      }
      if (error.capability === 'workspace-exports') {
        return 'export unavailable; an enqueue failure may have saved a failed export'
      }
      return 'capability unavailable in this environment'
    }
    case 'Unauthorized': {
      return 'credential no longer valid'
    }
    case 'RateLimited': {
      return 'write rate limit exceeded'
    }
    case 'PlanLimitExceeded': {
      return 'workspace plan limit exceeded'
    }
    case 'InvalidApiTokenInput': {
      return 'invalid API token input'
    }
    case 'ApiTokenNotRotatable': {
      return 'API token cannot be replaced'
    }
    case 'InvalidWebhookUrl': {
      return 'invalid webhook URL'
    }
    case 'WebhookEndpointNotFound': {
      return 'webhook endpoint not found'
    }
    case 'WebhookDeliveryNotFound': {
      return 'webhook delivery not found'
    }
    case 'WebhookDispatchRejected': {
      return `webhook dispatch refused: ${error.reason}`
    }
    case 'WorkspaceExportNotDownloadable': {
      return 'workspace export not downloadable'
    }
    case 'WorkspaceNotFound': {
      return 'workspace not found'
    }
  }
}

/** Success as JSON text; a typed failure as text the model can read, `isError` set. */
function outcomeToToolResult(outcome: ToolOutcome): CallToolResult {
  if (Result.isSuccess(outcome)) {
    return textResult(outcome.success)
  }
  if (outcome.failure._tag === 'WorkspaceSuspended') {
    return new CallToolResult({
      content: [{ type: 'text', text: failureText(outcome.failure) }],
      structuredContent: {
        _tag: 'WorkspaceSuspended',
        workspaceId: outcome.failure.workspaceId
      },
      isError: true
    })
  }
  return new CallToolResult({
    content: [{ type: 'text', text: failureText(outcome.failure) }],
    isError: true
  })
}

/**
 * The caller a handler authorizes as, or the internal error for an invocation
 * that never passed through the gate.
 */
function requireCaller(): Effect.Effect<McpCaller, InternalError> {
  return Effect.flatMap(CurrentMcpCaller, (caller) => {
    if (caller === undefined) {
      return Effect.fail(
        new InternalError({ message: 'no MCP caller bound to this request' })
      )
    }
    return Effect.succeed(caller)
  })
}

/**
 * Runs one operation's guard + read on the caller's workspace: the workspace
 * layer resolves this call's tenant (and, for an OAuth caller, proves the
 * Member still belongs to it). `Effect.result` sits OUTSIDE the workspace
 * layer, so a slug the layer cannot resolve — or a caller who is no longer a
 * member — fails while the layer builds, and that failure reaches the
 * classifier as the typed `WorkspaceNotFound` it is, not as a defect.
 */
function bridgedRead(
  env: ApiEnv,
  caller: McpCaller,
  body: Effect.Effect<
    unknown,
    CapabilityReadError,
    CapabilityReadServices | McpClientConnections | WorkspaceContext
  >
): Effect.Effect<ToolOutcome, never, CapabilityReadServices | McpClientConnections> {
  return Effect.result(
    provideWorkspace(
      env,
      caller.token.workspaceSlug,
      body,
      mcpCallerActor(caller),
      mcpCallerActorType(caller)
    )
  )
}

/** The invalid-params error a tool call answers undecodable arguments with. */
const formatIssue = SchemaIssue.makeFormatterDefault()
const invalidParams = Effect.mapError(
  (error: Schema.SchemaError) =>
    new InvalidParams({ message: formatIssue(error.issue) })
)
const decodePagedInput = Schema.decodeUnknownEffect(PAGED_TOOL_INPUT)
const decodeDeliveryIdInput = Schema.decodeUnknownEffect(DELIVERY_ID_TOOL_INPUT)
const decodeEndpointIdInput = Schema.decodeUnknownEffect(ENDPOINT_ID_TOOL_INPUT)

/**
 * Decodes a tool call's arguments against the row's input schema and hands
 * back the capability read, already bound to exactly the input shape the
 * operation takes. Decoding happens here — outside the workspace layer and
 * the permission guard — so a schema violation is a protocol-level
 * invalid-params error for the caller, never a tool failure the model would
 * try to read around.
 */
function decodeOperationInput(
  operation: WorkspaceReadOperation,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the protocol hands tool arguments over as opaque JSON; decoding them against the row's schema is this very function
  payload: unknown
): Effect.Effect<CapabilityRead, InvalidParams> {
  return Effect.gen(function* () {
    if (operation.param !== undefined) {
      if (operation.input === 'deliveryId') {
        const args = yield* decodeDeliveryIdInput(payload ?? {}).pipe(invalidParams)
        return Effect.suspend(() => operation.read(undefined, args))
      }
      const args = yield* decodeEndpointIdInput(payload ?? {}).pipe(invalidParams)
      return Effect.suspend(() => operation.read(undefined, args))
    }
    if (operation.paged) {
      const page = yield* decodePagedInput(payload ?? {}).pipe(invalidParams)
      return Effect.suspend(() => operation.read(page))
    }
    return Effect.suspend(() => operation.read(undefined))
  })
}

/**
 * Registers the tool-projecting rows of the operation table as MCP tools —
 * here the existing reads. Mutation registration uses typed JSON adapters
 * for the same catalog, per ADR 0072. Each invocation re-checks its own permission first — the route
 * gate only proved the caller holds a valid credential; a tool must never
 * serve data its REST counterpart would deny — and typed failures become
 * `isError` results the model can read.
 */
function registerTools(env: ApiEnv) {
  return Effect.gen(function* () {
    const registry = yield* McpServer
    // The isolate-level capability services, captured once: tool invocations
    // resolve them from this context rather than rebuilding any graph.
    const services = (yield* Effect.context<
      CapabilityReadServices | McpClientConnections
    >()).pipe(
      Context.pick(
        NotificationFeed,
        WorkspaceMembership,
        ApiTokenRegistry,
        WebhookEndpoints,
        WorkspaceSuspensionService,
        StrongAuthentication,
        AuditEventLog,
        McpClientConnections
      )
    )

    for (const operation of readOperations()) {
      yield* registry.addTool({
        tool: new McpTool({
          ...toolProjection(operation),
          title: operation.toolName,
          annotations: { readOnlyHint: true }
        }),
        annotations: Context.empty(),
        handle: (payload) =>
          Effect.gen(function* () {
            const caller = yield* requireCaller()
            const invoke = yield* decodeOperationInput(operation, payload)
            // One guard + one capability read, on the caller's workspace.
            // The operation guard needs a Scope, which only exists inside the
            // Effect runtime, hence the scoped wrapper here rather than in the
            // capability itself. The decoded input rides to the same read the
            // REST route serves — the two surfaces page identically.
            const guarded = Effect.gen(function* () {
              yield* authorizeMcpOperation(caller, operation.permission, MCP_READ_SCOPE)
              return yield* invoke
            }).pipe(Effect.scoped)

            const outcome = yield* bridgedRead(env, caller, guarded)
            return outcomeToToolResult(outcome)
          }).pipe(
            // Defects at this seam answer with the generic body, the way a
            // rejected promise did at the old SDK callback boundary.
            Effect.catchDefect(() =>
              Effect.succeed(
                new CallToolResult({
                  content: [{ type: 'text', text: TOOL_FAILED_MESSAGE }],
                  isError: true
                })
              )
            ),
            Effect.provideContext(services)
          )
      })
    }
  })
}

type McpInvocation = {
  readonly origin: string
  readonly rateKey: string
  readonly bearer: string | null
}
const CurrentMcpInvocation = Context.Reference<McpInvocation | undefined>(
  '@b2b-saas-starter/api/mcp/invocation',
  { defaultValue: () => undefined }
)

function mutationInputSchema(input: Schema.Constraint): ToolJsonSchema {
  if (Schema.toJsonSchemaDocument(input).schema.type === undefined) {
    return NO_TOOL_INPUT_SCHEMA
  }
  return advertisedInputSchema(input)
}

function registerMutationTools(env: ApiEnv) {
  return Effect.gen(function* () {
    const registry = yield* McpServer
    const services = (yield* Effect.context<
      | CapabilityMutationServices
      | RateLimiter
      | ApiTokenRegistry
      | OAuthTokenVerifier
      | McpClientConnections
    >()).pipe(
      Context.pick(
        ApiTokenRegistry,
        WebhookEndpoints,
        WorkspaceExports,
        WorkspaceSuspensionService,
        StrongAuthentication,
        RateLimiter,
        OAuthTokenVerifier,
        McpClientConnections
      )
    )
    for (const operation of mcpMutationOperations()) {
      yield* registry.addTool({
        tool: new McpTool({
          name: operation.toolName,
          description: `${operation.toolDescription} Mirrors ${operation.endpoint.method} /${mirroredRestPath(operation.endpoint.path)}.`,
          inputSchema: mutationInputSchema(operation.input),
          annotations: operation.annotations
        }),
        annotations: Context.empty(),
        handle: (payload) =>
          Effect.gen(function* () {
            yield* requireCaller()
            const invocation = yield* CurrentMcpInvocation
            if (invocation === undefined) {
              return yield* new InternalError({ message: 'no MCP invocation context' })
            }
            const verified = yield* Effect.result(
              Effect.gen(function* () {
                yield* enforceRateLimitKey('rest_write', invocation.rateKey)
                return yield* verifyMcpCredential(invocation.bearer)
              }).pipe(Effect.scoped)
            )
            if (Result.isFailure(verified)) {
              return outcomeToToolResult(verified)
            }
            const caller = verified.success
            const invoke = yield* operation.decode(payload ?? {}).pipe(invalidParams)
            const guarded = Effect.gen(function* () {
              const principal = yield* authorizeMcpOperation(
                caller,
                operation.permission,
                MCP_WRITE_SCOPE
              )
              let recipient: WorkspaceExportRecipient = { type: 'api_token' }
              if (caller.kind === 'oauth') {
                if (caller.token.sessionId === undefined) {
                  return yield* new StrongAuthenticationRequired()
                }
                recipient = {
                  type: 'session',
                  userId: caller.token.userId,
                  sessionId: caller.token.sessionId
                }
              }
              return yield* invoke.pipe(
                Effect.provideService(OperationExportRecipient, recipient),
                Effect.provideService(OperationPrincipal, principal),
                Effect.provideService(OperationOrigin, invocation.origin)
              )
            }).pipe(Effect.scoped)
            const outcome = yield* Effect.result(
              provideWorkspace(
                env,
                caller.token.workspaceSlug,
                guarded,
                mcpCallerActor(caller),
                mcpCallerActorType(caller)
              )
            )
            return outcomeToToolResult(outcome)
          }).pipe(
            Effect.catchDefect(() =>
              Effect.logError('MCP mutation defect', { tool: operation.toolName }).pipe(
                Effect.andThen(
                  Effect.succeed(
                    new CallToolResult({
                      content: [{ type: 'text', text: TOOL_FAILED_MESSAGE }],
                      isError: true
                    })
                  )
                )
              )
            ),
            Effect.provideContext(services)
          )
      })
    }
  })
}

/**
 * The one resource: the caller's workspace overview, projected from the same
 * row the overview tool and the REST route serve. The resource re-checks that
 * row's permission like both of them — a resource may not serve data its own
 * tool would deny. The protocol's resource channel has no `isError` half, so
 * every typed failure is answered as an internal error carrying the same
 * text vocabulary the tools use.
 */
function registerOverviewResource(env: ApiEnv) {
  return registerResource({
    uri: OVERVIEW_RESOURCE_URI,
    name: 'workspace-overview',
    description: "The caller's workspace record with its notification feed, as JSON.",
    mimeType: 'application/json',
    content: Effect.gen(function* () {
      const caller = yield* requireCaller()
      const guarded = Effect.gen(function* () {
        yield* authorizeMcpOperation(
          caller,
          READ_OPERATIONS.overview.permission,
          MCP_READ_SCOPE
        )
        return yield* READ_OPERATIONS.overview.read()
      }).pipe(Effect.scoped)
      const outcome = yield* bridgedRead(env, caller, guarded)
      if (Result.isFailure(outcome)) {
        // The protocol's resource channel has no `isError` half, so every
        // typed failure answers as an internal error carrying the same text
        // vocabulary the tools use — one mapper, both channels.
        return yield* Effect.fail(
          new InternalError({ message: failureText(outcome.failure) })
        )
      }
      // oxlint-disable-next-line effect/noGlobals -- MCP resource contents are JSON text by protocol definition
      return JSON.stringify(outcome.success, null, 2)
    }).pipe(
      Effect.catchDefect(() =>
        Effect.fail(new InternalError({ message: TOOL_FAILED_MESSAGE }))
      )
    )
  })
}

/**
 * A guard failure, encoded the way the contract encodes it: the status from
 * the tag→status table in `packages/api` (`errors.test.ts` pins each row to
 * the schema's own `httpApiStatus` annotation, so REST and this surface
 * cannot drift), and the body from the schema's own encoding — so a rejected
 * `/mcp` request answers exactly as a rejected REST route would. Only the
 * JSON-RPC bodies inside the protocol are this surface's own shape.
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

const isGuardFailure = Schema.is(GuardFailure)

/**
 * The isolate-level services the credential gate draws on — the same
 * memoized `capabilities` value the REST groups ride on, captured once when
 * the middleware layer builds and provided around each request, so the gate
 * never depends on route middleware ordering.
 */
type GateServices = RateLimiter | ApiTokenRegistry | OAuthTokenVerifier

/**
 * The gate around `layerHttp`'s routes: rate-limit, authenticate (API Token
 * or OAuth access token), then publish the caller and run the protocol
 * handler. `layerHttp` owns the route handlers, so the guards ride as
 * route-scoped router middleware — every protocol request (POST and the
 * method-not-allowed probes alike) draws the `mcp` bucket and answers a
 * rejected credential the way REST does. Guard failures escape the body so
 * `observed` records them like any other rejected request.
 *
 * There is deliberately no permission check beside authentication: every
 * credential the system can mint already clears `mcp:read` (the read and
 * write token scopes carry it, and the OAuth verifier refuses a token without
 * it), so a gate here could never deny. The real enforcement is per tool —
 * each invocation re-checks its own `operation.permission`, the same
 * permission its REST counterpart demands.
 */
function makeGate(
  env: ApiEnv
): Effect.Effect<
  (
    httpEffect: Effect.Effect<HttpServerResponse.HttpServerResponse, Types.unhandled>
  ) => Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    Types.unhandled,
    HttpServerRequest.HttpServerRequest
  >,
  never,
  GateServices
> {
  return Effect.gen(function* () {
    const limiter = yield* RateLimiter
    const registry = yield* ApiTokenRegistry
    const verifier = yield* OAuthTokenVerifier
    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest
        return yield* Effect.catchIf(
          observed(
            env,
            request,
            'mcp.protocol',
            {},
            Effect.gen(function* () {
              yield* enforceRateLimit(request, 'mcp')
              const bearer = bearerToken(request)
              const caller = yield* verifyMcpCredential(bearer)
              return yield* httpEffect.pipe(
                Effect.provideService(CurrentMcpCaller, caller),
                Effect.provideService(CurrentMcpInvocation, {
                  origin: new URL(webRequest(request).url).origin,
                  rateKey: clientKey(webRequest(request)),
                  bearer
                })
              )
            })
          ),
          isGuardFailure,
          (failure) => Effect.succeed(failureResponse(env, request, failure))
        )
      }).pipe(
        Effect.provideService(RateLimiter, limiter),
        Effect.provideService(ApiTokenRegistry, registry),
        Effect.provideService(OAuthTokenVerifier, verifier)
      )
  })
}

/**
 * The MCP protocol surface at `POST /mcp`: Effect's `McpServer` over
 * streamable HTTP (2025-11-25), its tools and resource projected row by row
 * from the shared operation table, and the credential gate wrapped around the
 * routes as middleware. Requires the isolate-level capability services —
 * `http.ts` provides the same `capabilities` value the REST groups ride on,
 * so one build serves both surfaces.
 */
export function mcpProtocolLayer(
  env: ApiEnv
): Layer.Layer<
  never,
  never,
  | HttpRouter.HttpRouter
  | CapabilityReadServices
  | CapabilityMutationServices
  | McpClientConnections
  | GateServices
> {
  const gate = HttpRouter.middleware(makeGate(env)).layer
  const registrations: Layer.Layer<
    never,
    never,
    | CapabilityReadServices
    | CapabilityMutationServices
    | McpClientConnections
    | RateLimiter
    | OAuthTokenVerifier
  > = Layer.effectDiscard(
    Effect.gen(function* () {
      yield* registerTools(env)
      yield* registerMutationTools(env)
      yield* registerOverviewResource(env)
    })
  ).pipe(Layer.provide(McpServer.layer))

  const protocol: Layer.Layer<never, never, HttpRouter.HttpRouter> = mcpLayerHttp({
    name: MCP_SERVER_NAME,
    version: '0.1.0',
    protocols: [v2025_11_25],
    path: '/mcp'
    // oxlint-disable-next-line eslint/no-restricted-properties -- the protocol layer's only build failure is an empty protocol list, and the list here is a non-empty literal; there is no runtime condition this layer could truthfully report
  }).pipe(Layer.orDie)

  return Layer.mergeAll(
    // `orDie` on the protocol layer because its only build failure is an
    // empty protocol list — a constant here, not a runtime condition.
    protocol,
    registrations
  ).pipe(Layer.provide(gate))
}
