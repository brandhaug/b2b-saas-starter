import {
  McpClientConnections,
  type McpClientConnection
} from '@b2b-saas-starter/capabilities/developer-platform/mcp-client-connections'
import { createServerFn } from '@tanstack/react-start'
import { Effect, Schema } from 'effect'

import { runCapabilities } from '../capabilities'
import { requireRequestSession } from './auth'

/**
 * The account page's "Connected MCP clients" segment (ADR 0055): the consents
 * the signed-in user holds, and their revocation. Account-level reads, so
 * neither goes through a workspace layer — the consent names its workspace
 * itself. The row type comes from the capability module directly
 * (`McpClientConnection`); this file holds only the loader and the revoke
 * server fn.
 */

/** The account route's loader segment. */
export function loadMcpClientConnections(input: {
  readonly userId: string
}): Promise<ReadonlyArray<McpClientConnection>> {
  return runCapabilities(
    Effect.flatMap(McpClientConnections, (connections) =>
      connections.listForUser(input.userId)
    )
  )
}

const RevokeInput = Schema.Struct({ connectionId: Schema.NonEmptyString })
const decodeRevokeInput = Schema.decodeUnknownSync(RevokeInput)

/**
 * Revokes one connection: the consent, the tokens it minted, and the
 * `mcp_client.consent_revoked` Audit Event, in one batch inside the
 * capability. The owner is the session, never the input — another user's
 * connection id revokes nothing and returns `false`.
 */
export const revokeMcpClientServerFn = createServerFn({ method: 'POST' })
  .validator((input) => decodeRevokeInput(input))
  .handler(async ({ data }): Promise<boolean> => {
    const session = await requireRequestSession()
    return runCapabilities(
      Effect.flatMap(McpClientConnections, (connections) =>
        connections.revoke({ userId: session.user.id, connectionId: data.connectionId })
      )
    )
  })
