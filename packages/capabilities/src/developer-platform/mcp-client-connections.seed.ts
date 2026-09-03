import { Effect, Layer } from 'effect'

import { AuditEventLog } from '../governance/audit-event-log.ts'
import {
  McpClientConnections,
  type McpClientConnection,
  type McpClientSummary
} from './mcp-client-connections.ts'

/**
 * In-memory adapter: the fixture connections, mutable so a revoke disappears
 * from the next list and cannot be revoked twice, mirroring Live's
 * post-conditions. Audit events land in the shared fixture log.
 */
export function SeedMcpClientConnections(seed: {
  readonly clients: ReadonlyArray<McpClientSummary>
  readonly connections: ReadonlyArray<McpClientConnection>
}): Layer.Layer<McpClientConnections, never, AuditEventLog> {
  return Layer.effect(McpClientConnections)(
    Effect.gen(function* () {
      const audit = yield* AuditEventLog
      const connections: Array<McpClientConnection & { readonly userId: string }> =
        seed.connections.map((connection) => ({
          ...connection,
          // Every fixture consent belongs to the demo user: the account page is
          // signed in as them in local development.
          userId: 'usr_demo'
        }))

      return {
        describeClient: (clientId) =>
          Effect.succeed(
            seed.clients.find((client) => client.clientId === clientId) ?? null
          ),
        listForUser: (userId) =>
          Effect.succeed(
            // One pass: filter to the user's connections and project away the
            // fixture's `userId` key, which the interface does not carry.
            connections
              .reduce<Array<McpClientConnection>>((found, connection) => {
                if (connection.userId === userId) {
                  found.push({
                    id: connection.id,
                    client: connection.client,
                    workspace: connection.workspace,
                    scopes: connection.scopes,
                    grantedAt: connection.grantedAt
                  })
                }
                return found
              }, [])
              .toSorted((a, b) => {
                if (a.grantedAt > b.grantedAt) {
                  return -1
                }
                if (a.grantedAt < b.grantedAt) {
                  return 1
                }
                return 0
              })
          ),
        recordGrant: (input) =>
          audit.record({
            workspaceId: input.workspaceId,
            actorUserId: input.userId,
            eventType: 'mcp_client.consent_granted',
            targetType: 'mcp_client',
            targetId: input.clientId,
            metadata: { scopes: [...input.scopes] }
          }),
        revoke: (input) =>
          Effect.gen(function* () {
            const index = connections.findIndex(
              (connection) =>
                connection.id === input.connectionId &&
                connection.userId === input.userId
            )
            const connection = connections[index]
            if (connection === undefined) {
              return false
            }
            connections.splice(index, 1)
            yield* audit.record({
              workspaceId: connection.workspace?.id ?? null,
              actorUserId: input.userId,
              eventType: 'mcp_client.consent_revoked',
              targetType: 'mcp_client',
              targetId: connection.client.clientId,
              metadata: { scopes: [...connection.scopes] }
            })
            return true
          })
      }
    })
  )
}
