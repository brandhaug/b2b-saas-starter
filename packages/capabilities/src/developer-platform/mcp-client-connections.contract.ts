import { Effect } from 'effect'
import { type CapabilityUnavailable } from '../errors.ts'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { type ContractExpectMatchers } from '../governance/contract-expect.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { McpClientConnections } from './mcp-client-connections.ts'

/**
 * The MCP client connections contract, written once and run against both
 * adapters — capabilities invariant 4, the same pattern as the other
 * developer-platform contracts. Only what both adapters can honestly promise
 * from an empty store lives here; each adapter's own suite covers the flows
 * that need its own state (the provider-written consent rows on Live, the
 * fixture list on Seed).
 */

export type McpClientConnectionsContractCase = {
  readonly name: string
  readonly assert: Effect.Effect<
    void,
    CapabilityUnavailable,
    McpClientConnections | AuditEventLog | WorkspaceContext
  >
}

/**
 * The slice of vitest's `expect` these cases use — deliberately narrow, like
 * the sibling contracts.
 */
export type McpContractExpect = <A>(
  actual: A
) => Pick<ContractExpectMatchers<A>, 'toBe' | 'toEqual'>

export function mcpClientConnectionsContractCases(
  expect: McpContractExpect
): ReadonlyArray<McpClientConnectionsContractCase> {
  return [
    {
      name: 'describeClient resolves no client for an unknown id',
      assert: Effect.gen(function* () {
        const connections = yield* McpClientConnections
        expect(
          yield* connections.describeClient('https://missing.example/client.json')
        ).toBe(null)
      })
    },
    {
      name: 'revoking an unknown or foreign connection resolves false',
      assert: Effect.gen(function* () {
        const connections = yield* McpClientConnections
        expect(
          yield* connections.revoke({
            userId: 'usr_anyone',
            connectionId: 'con_missing'
          })
        ).toBe(false)
      })
    },
    {
      name: 'recordGrant records mcp_client.consent_granted naming the client',
      assert: Effect.gen(function* () {
        const connections = yield* McpClientConnections
        const log = yield* AuditEventLog
        const ctx = yield* WorkspaceContext

        yield* connections.recordGrant({
          // A user both adapters know: the live harness's fixture owner (the
          // audit row's `actor_user_id` is a real FK on D1).
          userId: 'usr_owner',
          workspaceId: ctx.workspace.id,
          clientId: 'https://contract.example/client.json',
          scopes: ['mcp:read']
        })

        const page = yield* log.list({ eventType: 'mcp_client.consent_granted' })
        expect(
          page.events.some(
            (event) =>
              event.targetId === 'https://contract.example/client.json' &&
              event.targetType === 'mcp_client'
          )
        ).toBe(true)
      })
    }
  ]
}
