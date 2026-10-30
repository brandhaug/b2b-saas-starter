import { env } from 'cloudflare:workers'
import { enforceSecureEndpoints } from '@b2b-saas-starter/env/transport'
import { setDeploymentIdentity } from '@b2b-saas-starter/env/deployment'
import { minimumWebTlsResponse } from './lib/public-key-transport'
import { runRequest } from './start'
import { csrfResponse } from './http/csrf'
import { serveHttpRoute } from './http/routes'
import { createTransport } from './http/transport'
import { loadPageData } from './http/page-loader'
import { type PageData } from './http/page-contract'

// Node preview's upgrade bridge uses exactly the authenticated socket boundary.
export { connectAssistantConversation } from './lib/server/assistant-conversation-socket'

export type RenderPage = (context: {
  readonly request: Request
  readonly data: PageData
}) => Response | Promise<Response>

/** Construct once per isolate. The callback renders native Foldkit within the request scope. */
export function createWebHandler() {
  const transport = createTransport()
  return {
    dispose: transport.dispose,
    async fetch(request: Request, render: RenderPage): Promise<Response> {
      enforceSecureEndpoints(env)
      const tls = minimumWebTlsResponse(request, env.ENVIRONMENT)
      if (tls) {
        return tls
      }
      const response = await runRequest(request, async () => {
        const path = new URL(request.url).pathname
        if (path.startsWith('/api/web/')) {
          const refusal = csrfResponse(request)
          if (refusal) {
            return refusal
          }
          const result = await transport.handler(request)
          result.headers.set('Cache-Control', 'private, no-store')
          return result
        }
        const http = await serveHttpRoute(request)
        if (http) {
          return http
        }
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } })
        }
        // oxlint-disable-next-line effect/noTryCatch -- the Fetch boundary recognizes navigation Responses from Promise loaders
        try {
          const data = await loadPageData(request)
          const page = await render({ request, data })
          const headers = new Headers(page.headers)
          // Session-aware public chrome and permission-shaped page data are never shared-cacheable.
          headers.set('Cache-Control', 'private, no-store')
          return new Response(request.method === 'HEAD' ? null : page.body, {
            status: data.status === 200 ? page.status : data.status,
            statusText: page.statusText,
            headers
          })
        } catch (error) {
          if (error instanceof Response) {
            return error
          }
          // oxlint-disable-next-line effect/noThrowStatement -- preserve unexpected failures for the request observability scope
          throw error
        }
      })
      return ['/', '/en'].includes(new URL(request.url).pathname)
        ? setDeploymentIdentity(response, env.GIT_COMMIT_SHA, env.SERVICE_VERSION)
        : response
    }
  }
}
