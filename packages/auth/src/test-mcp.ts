import { type AuthConfig } from './index.ts'

/**
 * The `AuthConfig.mcp` every test suite carries: the local resource URL and a
 * CIMD transport that refuses if ever reached — no suite exercises client
 * discovery (the live OAuth flow inserts its client rows directly, and the
 * rest mock or skip the provider), so a call here is a bug, and the throw is
 * the assertion.
 */
export function testMcpConfig(): AuthConfig['mcp'] {
  return {
    resource: 'http://localhost:8787/mcp',
    fetchClientMetadataResource: () => {
      // oxlint-disable-next-line effect/noThrowStatement, effect/noNewError -- a reached transport is a programmer error in a test helper; the throw is the failure channel
      throw new TypeError('client discovery is not exercised by this suite')
    }
  }
}
