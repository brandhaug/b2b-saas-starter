import { Effect, Layer } from 'effect'

import { AuditEventLog } from '../governance/audit-event-log.ts'
import {
  recordSecurityEvidence,
  type SecurityEvidenceSink
} from '../governance/security-recovery-evidence.ts'
import { demoUserIdentity } from '../seed-fixture.ts'
import {
  consentGrantedAuditEvent,
  consentRevokedAuditEvent,
  McpClientConnections,
  type McpClientConnection,
  type McpClientSummary
} from './mcp-client-connections.ts'

/**
 * A fixture client, plus the registration column the wire shape does not
 * carry: Live's `getGrant` joins `oauth_client` and refuses a grant whose
 * client has been disabled, so the fixture has to be able to say that too.
 */
export type SeedMcpClient = McpClientSummary & {
  /** Defaults to an enabled registration, which is what a fixture usually means. */
  readonly disabled?: boolean
}

/**
 * A fixture consent, plus the storage column the wire shape does not carry.
 * Live's grant binding is `<consentId>:<grantVersion>`; the version is what a
 * re-consent bumps, so a fixture that pinned it to `0` would let a stale
 * binding keep passing.
 */
export type SeedMcpConnection = McpClientConnection & {
  /** Defaults to `0`, the version a never-re-consented grant carries. */
  readonly grantVersion?: number
}

/**
 * In-memory adapter: the fixture connections, mutable so a revoke disappears
 * from the next list and cannot be revoked twice, mirroring Live's
 * post-conditions. Audit events land in the shared fixture log.
 */
export function SeedMcpClientConnections(
  seed: {
    readonly clients: ReadonlyArray<SeedMcpClient>
    readonly connections: ReadonlyArray<SeedMcpConnection>
  },
  /** The same optional sink the Live adapter takes; see `SeedWorkspaceMembership`. */
  securityEvidence?: SecurityEvidenceSink
): Layer.Layer<McpClientConnections, never, AuditEventLog> {
  return Layer.effect(McpClientConnections)(
    Effect.gen(function* () {
      const audit = yield* AuditEventLog
      const connections: Array<
        McpClientConnection & {
          readonly userId: string
          readonly grantVersion: number
        }
      > = seed.connections.map((connection) => ({
        ...connection,
        // Every fixture consent belongs to the demo owner: the account page is
        // signed in as them in local development. Named from the fixture
        // module that owns the demo identity, never spelled out here.
        userId: demoUserIdentity.id,
        grantVersion: connection.grantVersion ?? 0
      }))

      /** Live joins `oauth_client`; here the fixture's own client list is the join. */
      function isDisabled(clientId: string): boolean {
        return seed.clients.some(
          (client) => client.clientId === clientId && client.disabled === true
        )
      }

      return {
        getGrant: Effect.fn('McpClientConnections.getGrant')((input) =>
          Effect.sync(() => {
            const grant = connections.find(
              (connection) =>
                connection.userId === input.userId &&
                connection.client.clientId === input.clientId &&
                connection.workspace?.id === input.workspaceId
            )
            // Same two refusals as Live: no grant, or a grant whose client
            // registration has been disabled since it was made.
            if (!grant || isDisabled(grant.client.clientId)) {
              return null
            }
            return {
              binding: `${grant.id}:${String(grant.grantVersion)}`,
              scopes: grant.scopes
            }
          })
        ),
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
        recordGrant: (input) => audit.record(consentGrantedAuditEvent(input)),
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
            yield* recordSecurityEvidence(
              {
                kind: 'oauth_grant_revoked',
                subjectId: connection.id,
                workspaceId: connection.workspace?.id ?? undefined
              },
              securityEvidence,
              'seed'
            )
            yield* audit.record(
              consentRevokedAuditEvent({
                userId: input.userId,
                clientId: connection.client.clientId,
                scopes: connection.scopes,
                // Same rule as Live: a consent outliving its workspace audits
                // with no workspace, never a dangling id.
                workspaceId: connection.workspace?.id ?? null
              })
            )
            return true
          })
      }
    })
  )
}
