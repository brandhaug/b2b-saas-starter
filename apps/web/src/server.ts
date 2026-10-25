// Node preview's upgrade bridge uses the same authenticated boundary as the route.
export { connectAssistantConversation } from './lib/server/assistant-conversation-socket'
import StartServerEntry from '@tanstack/react-start/server-entry'
import { env as cloudflareEnv } from 'cloudflare:workers'
import { enforceSecureEndpoints } from '@b2b-saas-starter/env/transport'
import { setDeploymentIdentity } from '@b2b-saas-starter/env/deployment'
import { minimumWebTlsResponse } from './lib/public-key-transport'

const worker = {
  async fetch(request: Request): Promise<Response> {
    enforceSecureEndpoints(cloudflareEnv)
    const tlsResponse = minimumWebTlsResponse(request, cloudflareEnv.ENVIRONMENT)
    if (tlsResponse !== undefined) {
      return tlsResponse
    }
    const response = await StartServerEntry.fetch(request)
    if (['/', '/en'].includes(new URL(request.url).pathname)) {
      return setDeploymentIdentity(
        response,
        cloudflareEnv.GIT_COMMIT_SHA,
        cloudflareEnv.SERVICE_VERSION
      )
    }
    return response
  }
}

export default worker
