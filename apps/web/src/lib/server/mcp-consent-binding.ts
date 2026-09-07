import { bindMcpConsentSession } from '@b2b-saas-starter/auth'
import { type McpConsentBinding } from '@b2b-saas-starter/capabilities/developer-platform/mcp-client-connections'
import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { Effect } from 'effect'

import { MissingD1Binding } from './auth-local-d1'

/** Web adapter for the auth-owned MCP consent session binding. */
export const webMcpConsentBinding: McpConsentBinding = {
  bindSession: (input) => {
    const db = env.DB
    if (db === undefined) {
      return Effect.runPromise(Effect.fail(new MissingD1Binding({ property: 'DB' })))
    }
    return bindMcpConsentSession(drizzle(db), input)
  }
}
