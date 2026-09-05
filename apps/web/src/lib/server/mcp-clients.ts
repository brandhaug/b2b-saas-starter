import { type McpClientConnection } from '@b2b-saas-starter/capabilities/developer-platform/mcp-client-connections'
import { createServerFn } from '@tanstack/react-start'
import { Schema } from 'effect'

/**
 * The account page's "Connected MCP clients" server functions (ADR 0068), in
 * a **client-safe** module — the client-safe half of the
 * `mcp-clients.effects.ts` split; see apps/web/AGENTS.md for the rule and
 * `scripts/assert-client-boundary.mjs` for the enforcement. Each input is
 * written once, as its Effect Schema: the validator is the single strict
 * decode, and the derived type types both the client stub and the effects
 * handler.
 */

const RevokeInput = Schema.Struct({ connectionId: Schema.NonEmptyString })

export type RevokeInput = typeof RevokeInput.Type

/** The account route's loader segment: the consents the signed-in user holds. */
export const loadMcpClientConnectionsServerFn = createServerFn({
  method: 'GET'
}).handler(async (): Promise<ReadonlyArray<McpClientConnection>> => {
  const { loadMcpClientConnectionsHandler } = await import('./mcp-clients.effects')
  return loadMcpClientConnectionsHandler()
})

/**
 * Revokes one connection: the consent, the tokens it minted, and the
 * `mcp_client.consent_revoked` Audit Event, in one batch inside the
 * capability. The owner is the session, never the input — another user's
 * connection id revokes nothing and returns `false`.
 */
export const revokeMcpClientServerFn = createServerFn({ method: 'POST' })
  .validator(Schema.decodeUnknownSync(RevokeInput))
  .handler(async ({ data }): Promise<boolean> => {
    const { revokeMcpClientHandler } = await import('./mcp-clients.effects')
    return revokeMcpClientHandler(data)
  })
