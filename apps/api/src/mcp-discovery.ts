import { WorkspaceMembership } from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import { WorkspaceSuspensionService } from '@b2b-saas-starter/capabilities/governance/workspace-suspension'
import { StrongAuthentication } from '@b2b-saas-starter/capabilities/governance/strong-authentication'
import { McpClientConnections } from '@b2b-saas-starter/capabilities/developer-platform/mcp-client-connections'
import { PlatformUserAdmin } from '@b2b-saas-starter/capabilities/governance/platform-user-admin'
import {
  MCP_READ_SCOPE,
  MCP_WRITE_SCOPE
} from '@b2b-saas-starter/authz/mcp-access-token'
import { type McpDiscovery } from '@b2b-saas-starter/api'
import { Context, Effect } from 'effect'
import { visibility } from 'effect/ai/McpServer'
import { type ApiEnv } from './env.ts'
import {
  MCP_SERVER_NAME,
  OVERVIEW_RESOURCE_URI,
  mutationToolProjection,
  toolProjection
} from './mcp-catalog.ts'
import {
  authorizeMcpOperation,
  provideMcpWorkspace,
  type McpCaller
} from './mcp-caller.ts'
import { CurrentMcpRequest } from './mcp-credential-gate.ts'
import { mcpMutationOperations } from './mcp-mutations.ts'
import { READ_OPERATIONS, readOperations } from './operations.ts'

/** Catalog projection, filtered per request by scopedMcpDiscovery before serving. */
export function mcpDiscoveryDocument(): McpDiscovery {
  return {
    name: MCP_SERVER_NAME,
    resources: [OVERVIEW_RESOURCE_URI],
    tools: [
      ...readOperations().map(toolProjection),
      ...mcpMutationOperations().map(mutationToolProjection)
    ]
  }
}

/** Discovery reuses execution authorization without invoking the operation. */
function operationVisible(env: ApiEnv, caller: McpCaller, target: string) {
  const read = readOperations().find((operation) => operation.toolName === target)
  const mutation = mcpMutationOperations().find(
    (operation) => operation.toolName === target
  )
  let operation = read ?? mutation
  if (target === OVERVIEW_RESOURCE_URI) {
    operation = READ_OPERATIONS.overview
  }
  if (operation === undefined) {
    return Effect.succeed(false)
  }
  let requiredScope: typeof MCP_READ_SCOPE | typeof MCP_WRITE_SCOPE = MCP_READ_SCOPE
  if (mutation !== undefined) {
    requiredScope = MCP_WRITE_SCOPE
  }
  return provideMcpWorkspace(
    env,
    caller,
    authorizeMcpOperation(caller, operation.permission, requiredScope).pipe(
      Effect.scoped
    )
  ).pipe(Effect.isSuccess)
}

export const scopedMcpDiscovery = Effect.fn('Mcp.discovery')(function* (
  env: ApiEnv,
  caller: McpCaller
) {
  const document = mcpDiscoveryDocument()
  const tools = yield* Effect.filter(document.tools, (tool) =>
    operationVisible(env, caller, tool.name)
  )
  const resources = yield* Effect.filter(document.resources, (uri) =>
    operationVisible(env, caller, uri)
  )
  return { ...document, tools, resources }
})

/** `tools/list` and `resources/list` advertise only what the caller may call. */
export function discoveryVisibility(env: ApiEnv) {
  return visibility(
    Effect.gen(function* () {
      const services = (yield* Effect.context<
        | WorkspaceMembership
        | PlatformUserAdmin
        | McpClientConnections
        | StrongAuthentication
        | WorkspaceSuspensionService
      >()).pipe(
        Context.pick(
          WorkspaceMembership,
          PlatformUserAdmin,
          McpClientConnections,
          StrongAuthentication,
          WorkspaceSuspensionService
        )
      )
      return ({ method, target }) => {
        // Calls retain their existing typed permission failures and write admission.
        if (
          method === 'tools/call' ||
          method === 'resources/read' ||
          method === 'prompts/get' ||
          method === 'completion/complete'
        ) {
          return Effect.as(CurrentMcpRequest, true)
        }
        return Effect.flatMap(CurrentMcpRequest, ({ caller }) =>
          operationVisible(env, caller, target)
        ).pipe(Effect.provideContext(services))
      }
    })
  )
}
