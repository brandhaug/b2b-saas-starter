import { McpClientConnections } from '@b2b-saas-starter/capabilities/developer-platform/mcp-client-connections'
import { PlatformUserAdmin } from '@b2b-saas-starter/capabilities/governance/platform-user-admin'
import { type WorkspaceContext } from '@b2b-saas-starter/capabilities/workspace-context'
import { annotateWideEventCause } from '@b2b-saas-starter/logger'
import {
  MCP_READ_SCOPE,
  MCP_WRITE_SCOPE
} from '@b2b-saas-starter/authz/mcp-access-token'
import { RateLimiter } from '@b2b-saas-starter/api'
import { Context, Cause, Effect, Layer, Option, Result } from 'effect'
import { type HttpRouter } from 'effect/http'
import {
  McpServer,
  layerHttp as mcpLayerHttp,
  registerResource
} from 'effect/ai/McpServer'
import { v2025_11_25 } from 'effect/ai/McpProtocol'
import { CallToolResult, InternalError, Tool as McpTool } from 'effect/ai/McpSchema'
import { type ApiEnv } from './env.ts'
import {
  MCP_SERVER_NAME,
  OVERVIEW_RESOURCE_URI,
  decodeOperationInput,
  invalidParams,
  mutationToolProjection,
  toolProjection
} from './mcp-catalog.ts'
import {
  authorizeMcpOperation,
  mcpCallerPolicy,
  provideMcpWorkspace,
  verifyMcpCredential,
  type McpCaller
} from './mcp-caller.ts'
import {
  CurrentMcpRequest,
  mcpCredentialGate,
  type GateServices
} from './mcp-credential-gate.ts'
import { discoveryVisibility } from './mcp-discovery.ts'
import { mcpMutationOperations } from './mcp-mutations.ts'
import {
  TOOL_FAILED_MESSAGE,
  failureText,
  outcomeToToolResult,
  type ToolOutcome
} from './mcp-results.ts'
import {
  READ_OPERATIONS,
  readOperations,
  OperationOrigin,
  OperationExportRecipient,
  OperationPrincipal,
  capabilityMutationServices,
  capabilityReadServices,
  type CapabilityMutationServices,
  type CapabilityReadError,
  type CapabilityReadServices
} from './operations.ts'
import { OAuthTokenVerifier } from './oauth-access-token.ts'
import { annotateRequestFailure, enforceRateLimitKey } from './request-guards.ts'

/**
 * MCP protocol wiring: the Streamable HTTP transport and the tool and resource
 * registrations. The credential gate, discovery authorization, caller-kind
 * policy, wire projection and result encoding live in the sibling `mcp-*`
 * modules.
 *
 * Registrations live for the isolate; CurrentMcpRequest supplies each caller's
 * authority through the RPC context. Never capture a caller during registration.
 */

/** Streamable HTTP transport with request-scoped credential and rate-limit gates. */
export function mcpProtocolLayer(
  env: ApiEnv
): Layer.Layer<
  never,
  never,
  | HttpRouter.HttpRouter
  | CapabilityReadServices
  | CapabilityMutationServices
  | McpClientConnections
  | PlatformUserAdmin
  | GateServices
> {
  return mcpLayerHttp({
    name: MCP_SERVER_NAME,
    version: '0.1.0',
    protocols: [v2025_11_25],
    path: '/mcp',
    registrations: mcpRegistrations(env)
    // oxlint-disable-next-line eslint/no-restricted-properties -- the protocol layer's only build failure is an empty protocol list, and the list here is a non-empty literal; there is no runtime condition this layer could truthfully report
  }).pipe(Layer.orDie, Layer.provide(mcpCredentialGate(env)))
}

/** Catalog registrations shared by HTTP transport and protocol-level tests. */
export function mcpRegistrations(env: ApiEnv) {
  return Layer.effectDiscard(
    Effect.gen(function* () {
      yield* registerTools(env)
      yield* registerMutationTools(env)
      yield* registerOverviewResource(env)
    })
  ).pipe(Layer.provide(discoveryVisibility(env).layer))
}

/**
 * Bridge the low-level addTool callback's fixed service type. Higher-level
 * resource registration can express CurrentMcpRequest directly.
 */
function requireMcpRequest() {
  return Effect.flatMap(
    Effect.serviceOption(CurrentMcpRequest),
    Option.match({
      onNone: () =>
        Effect.fail(
          new InternalError({ message: 'no MCP authority bound to this request' })
        ),
      onSome: Effect.succeed
    })
  )
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
): Effect.Effect<
  ToolOutcome,
  never,
  CapabilityReadServices | McpClientConnections | PlatformUserAdmin
> {
  return Effect.result(provideMcpWorkspace(env, caller, body))
}

/** A typed tool failure becomes an `isError` result; its safe facts stay on the wide event. */
function observedToolResult(outcome: ToolOutcome): Effect.Effect<CallToolResult> {
  if (Result.isSuccess(outcome)) {
    return Effect.succeed(outcomeToToolResult(outcome))
  }
  return annotateRequestFailure(outcome.failure).pipe(
    Effect.as(outcomeToToolResult(outcome))
  )
}

/**
 * Defects at the tool seam answer with the generic body, the way a rejected
 * promise did at the old SDK callback boundary, after their summary is recorded.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- a defect is any thrown value; the logger keeps only its scrubbed summary
function toolDefect(defect: unknown): Effect.Effect<CallToolResult> {
  // oxlint-disable-next-line eslint/no-restricted-properties -- preserve an existing defect before translating it to a protocol response
  return annotateWideEventCause(Cause.die(defect)).pipe(
    Effect.as(
      new CallToolResult({
        content: [{ type: 'text', text: TOOL_FAILED_MESSAGE }],
        isError: true
      })
    )
  )
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
    const registrationServices = yield* Effect.context<never>()
    // The isolate-level capability services, captured once: tool invocations
    // resolve them from this context rather than rebuilding any graph.
    const services = (yield* Effect.context<
      CapabilityReadServices | McpClientConnections | PlatformUserAdmin
    >()).pipe(
      Context.pick(...capabilityReadServices, PlatformUserAdmin, McpClientConnections)
    )

    for (const operation of readOperations()) {
      yield* registry.addTool({
        tool: new McpTool({
          ...toolProjection(operation),
          title: operation.toolName,
          annotations: { readOnlyHint: true }
        }),
        services: registrationServices,
        annotations: Context.empty(),
        handle: (payload) =>
          Effect.gen(function* () {
            const { caller } = yield* requireMcpRequest()
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
            return yield* observedToolResult(outcome)
          }).pipe(Effect.catchDefect(toolDefect), Effect.provideContext(services))
      })
    }
  })
}

function registerMutationTools(env: ApiEnv) {
  return Effect.gen(function* () {
    const registry = yield* McpServer
    const registrationServices = yield* Effect.context<never>()
    const services = (yield* Effect.context<
      | CapabilityMutationServices
      | RateLimiter
      | OAuthTokenVerifier
      | McpClientConnections
      | PlatformUserAdmin
    >()).pipe(
      Context.pick(
        ...capabilityMutationServices,
        PlatformUserAdmin,
        RateLimiter,
        OAuthTokenVerifier,
        McpClientConnections
      )
    )
    for (const operation of mcpMutationOperations()) {
      yield* registry.addTool({
        tool: new McpTool({
          ...mutationToolProjection(operation),
          annotations: operation.annotations
        }),
        services: registrationServices,
        annotations: Context.empty(),
        handle: (payload) =>
          Effect.gen(function* () {
            const invocation = yield* requireMcpRequest()
            const verified = yield* Effect.result(
              Effect.gen(function* () {
                yield* enforceRateLimitKey('rest_write', invocation.rateKey)
                return yield* verifyMcpCredential(invocation.bearer)
              }).pipe(Effect.scoped)
            )
            if (Result.isFailure(verified)) {
              return yield* observedToolResult(verified)
            }
            const caller = verified.success
            const invoke = yield* operation.decode(payload ?? {}).pipe(invalidParams)
            const guarded = Effect.gen(function* () {
              const principal = yield* authorizeMcpOperation(
                caller,
                operation.permission,
                MCP_WRITE_SCOPE
              )
              const recipient = yield* mcpCallerPolicy(caller).exportRecipient
              return yield* invoke.pipe(
                Effect.provideService(OperationExportRecipient, recipient),
                Effect.provideService(OperationPrincipal, principal),
                Effect.provideService(OperationOrigin, invocation.origin)
              )
            }).pipe(Effect.scoped)
            const outcome = yield* Effect.result(
              provideMcpWorkspace(env, caller, guarded)
            )
            return yield* observedToolResult(outcome)
          }).pipe(Effect.catchDefect(toolDefect), Effect.provideContext(services))
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
  return Effect.gen(function* () {
    const services = (yield* Effect.context<
      CapabilityReadServices | McpClientConnections | PlatformUserAdmin
    >()).pipe(
      Context.pick(...capabilityReadServices, PlatformUserAdmin, McpClientConnections)
    )
    return yield* registerResource({
      uri: OVERVIEW_RESOURCE_URI,
      name: 'workspace-overview',
      description: "The caller's workspace record with its notification feed, as JSON.",
      mimeType: 'application/json',
      content: Effect.gen(function* () {
        const { caller } = yield* CurrentMcpRequest
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
        Effect.provideContext(services),
        Effect.catchDefect(() =>
          Effect.fail(new InternalError({ message: TOOL_FAILED_MESSAGE }))
        )
      )
    })
  })
}
