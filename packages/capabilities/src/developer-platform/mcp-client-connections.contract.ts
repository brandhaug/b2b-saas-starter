import { Effect } from 'effect'
import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { AuditEventLog } from '../governance/audit-event-log.ts'
import { type ContractExpect } from '../governance/contract-expect.ts'
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

/**
 * The consents each harness planted before the cases run. `getGrant` reads
 * state neither adapter can create through this interface (Live's rows are
 * the OAuth provider's writes, Seed's are fixture rows), so the ids and the
 * binding they must produce are handed in.
 */
export type McpGrantFixtures = {
  /** A live consent whose binding names a non-zero grant version. */
  readonly active: {
    readonly userId: string
    readonly clientId: string
    readonly workspaceId: string
    /** `<consentId>:<grantVersion>` — the exact string `getGrant` must return. */
    readonly binding: string
    readonly scopes: ReadonlyArray<string>
  }
  /** A consent as real as the one above, whose client registration is disabled. */
  readonly disabledClient: {
    readonly userId: string
    readonly clientId: string
    readonly workspaceId: string
  }
}

export type McpClientConnectionsContractCase = {
  readonly name: string
  readonly assert: Effect.Effect<
    void,
    CapabilityUnavailable,
    McpClientConnections | AuditEventLog | WorkspaceContext
  >
}

export function mcpClientConnectionsContractCases(
  grants: McpGrantFixtures,
  expect: ContractExpect
): ReadonlyArray<McpClientConnectionsContractCase> {
  return [
    {
      // The binding is the whole answer an MCP request is authorized against:
      // it carries the grant version a re-consent bumps, so a stale binding
      // stops matching. An adapter that pinned the version to zero would
      // authorize a revoked-and-reissued grant forever.
      name: 'getGrant returns the consent binding with its own grant version',
      assert: Effect.gen(function* () {
        const connections = yield* McpClientConnections
        const grant = yield* connections.getGrant({
          userId: grants.active.userId,
          clientId: grants.active.clientId,
          workspaceId: grants.active.workspaceId
        })
        expect(grant?.binding).toBe(grants.active.binding)
        expect([...(grant?.scopes ?? [])]).toEqual([...grants.active.scopes])
      })
    },
    {
      name: 'getGrant refuses a consent whose client registration is disabled',
      assert: Effect.gen(function* () {
        const connections = yield* McpClientConnections
        expect(
          yield* connections.getGrant({
            userId: grants.disabledClient.userId,
            clientId: grants.disabledClient.clientId,
            workspaceId: grants.disabledClient.workspaceId
          })
        ).toBe(null)
      })
    },
    {
      name: 'getGrant resolves nothing for a consent that was never made',
      assert: Effect.gen(function* () {
        const connections = yield* McpClientConnections
        expect(
          yield* connections.getGrant({
            userId: grants.active.userId,
            clientId: 'https://never.example/client.json',
            workspaceId: grants.active.workspaceId
          })
        ).toBe(null)
      })
    },
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
          page.items.some(
            (event) =>
              event.targetId === 'https://contract.example/client.json' &&
              event.targetType === 'mcp_client'
          )
        ).toBe(true)
      })
    }
  ]
}
