import {
  McpClientConnections,
  type McpClientConnection
} from '@b2b-saas-starter/capabilities/developer-platform/mcp-client-connections'
import { Effect } from 'effect'

import { runCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'
import { type RevokeInput } from './mcp-clients'

/**
 * The MCP-client connection effects and their server-only wiring, reached
 * only through dynamic `import()` inside the handlers of `mcp-clients.ts`
 * (see apps/web/AGENTS.md for the split).
 */

/**
 * The account page's "Connected MCP clients" segment (ADR 0068) as a plain
 * function, so tests drive it directly with fixture users against the Seed
 * layer. An account-level read — no workspace layer — the consent names its
 * workspace itself.
 */
export function loadMcpClientConnections(input: {
  readonly userId: string
}): Promise<ReadonlyArray<McpClientConnection>> {
  return runCapabilities(
    Effect.flatMap(McpClientConnections, (connections) =>
      connections.listForUser(input.userId)
    )
  )
}

/** The handler the loader server fn delegates to; the session keys the read. */
export async function loadMcpClientConnectionsHandler(): Promise<
  ReadonlyArray<McpClientConnection>
> {
  const session = await requireRequestSession()
  return loadMcpClientConnections({ userId: session.user.id })
}

/**
 * Revokes one connection: the consent, the tokens it minted, and the
 * `mcp_client.consent_revoked` Audit Event, in one batch inside the
 * capability. The owner is the session, never the input — another user's
 * connection id revokes nothing and returns `false`.
 */
export async function revokeMcpClientHandler(input: RevokeInput): Promise<boolean> {
  const session = await requireRequestSession()
  return runCapabilities(
    Effect.flatMap(McpClientConnections, (connections) =>
      connections.revoke({ userId: session.user.id, connectionId: input.connectionId })
    )
  )
}
