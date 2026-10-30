import { handleAuth } from '../lib/server/auth-http'
import { answeringLocalD1 } from '../lib/server/auth-local-d1'
import { serveOAuthDiscovery } from '../lib/server/oauth-discovery'
import { connectAssistantConversation } from '../lib/server/assistant-conversation-socket'
import { readSupportConfig } from '../lib/support-config.effects'

function methodNotAllowed(allow: string): Response {
  return new Response(null, { status: 405, headers: { Allow: allow } })
}

/** HTTP-only routes extracted from the original route tree before removing React. */
export async function serveHttpRoute(request: Request): Promise<Response | undefined> {
  const path = new URL(request.url).pathname
  if (path === '/api/auth' || path.startsWith('/api/auth/')) {
    return request.method === 'GET' || request.method === 'POST'
      ? handleAuth(request)
      : methodNotAllowed('GET, POST')
  }
  if (
    path === '/.well-known/oauth-authorization-server' ||
    path.startsWith('/.well-known/oauth-authorization-server/')
  ) {
    return request.method === 'GET'
      ? answeringLocalD1(() => serveOAuthDiscovery(request))
      : methodNotAllowed('GET')
  }
  const socket = /^\/api\/assistant\/([^/]+)\/connect$/.exec(path)
  if (socket?.[1]) {
    return request.method === 'GET'
      ? connectAssistantConversation(request, decodeURIComponent(socket[1]))
      : methodNotAllowed('GET')
  }
  if (path === '/api/support-config') {
    return request.method === 'GET'
      ? Response.json(readSupportConfig())
      : methodNotAllowed('GET')
  }
  return undefined
}
