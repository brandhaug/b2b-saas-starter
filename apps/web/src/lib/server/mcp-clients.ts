import { type McpClientConnection } from '@b2b-saas-starter/capabilities/developer-platform/mcp-client-connections'
import { createServerFn } from '@tanstack/react-start'

import { expectRecord, expectString } from './input-shape'

/**
 * The account page's "Connected MCP clients" server functions (ADR 0068), in
 * a **client-safe** module.
 *
 * This file is statically imported by the `/account` route and the MCP
 * clients panel, and the route tree ships to the browser — so everything at
 * this module's top level rides on every page. That is why the capability
 * effects and their wiring live in `mcp-clients.effects.ts` and are reached
 * only through dynamic `import()` inside each handler: TanStack Start strips
 * handler bodies from the client build, so the capabilities graph never
 * ships, while the row type (`McpClientConnection`, type-only here) still
 * does. The validators are stripped the same way handler bodies are —
 * `.validator()` runs on the server only — so the plain shape checks below
 * are the server's first decode, and the strict schema decodes again in
 * `mcp-clients.effects.ts` before anything runs.
 */

type RevokeInput = {
  readonly connectionId: string
}

/**
 * The server fn's validator, a plain shape check that runs on the server only
 * (TanStack strips `.validator()` from the client build): it is the server's
 * first decode, and the strict schema decodes again in
 * `mcp-clients.effects.ts`. This probe IS the I/O boundary, so `unknown` in
 * and `throw` out is the contract, the same exemption `pickOptionalStrings`
 * carries (lib/utils.ts).
 */
// oxlint-disable anti-slop/no-unknown-parameters
function decodeRevokeInput(input: unknown): RevokeInput {
  const record = expectRecord(input, 'mcp client input')
  return { connectionId: expectString(record, 'connectionId', 'mcp client input') }
}
// oxlint-enable anti-slop/no-unknown-parameters

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
  .validator(decodeRevokeInput)
  .handler(async ({ data }): Promise<boolean> => {
    const { revokeMcpClientHandler } = await import('./mcp-clients.effects')
    return revokeMcpClientHandler(data)
  })
