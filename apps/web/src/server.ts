// Node preview's upgrade bridge uses the same authenticated boundary as the route.
export { connectAssistantConversation } from './lib/server/assistant-conversation-socket'
import StartServerEntry from '@tanstack/react-start/server-entry'
import { env as cloudflareEnv } from 'cloudflare:workers'
import { enforceSecureEndpoints } from '@b2b-saas-starter/env/transport'
import { minimumWebTlsResponse } from './lib/public-key-transport'

const worker = {
  fetch(request: Request): Promise<Response> | Response {
    enforceSecureEndpoints(cloudflareEnv)
    const tlsResponse = minimumWebTlsResponse(request, cloudflareEnv.ENVIRONMENT)
    if (tlsResponse !== undefined) {
      return tlsResponse
    }
    return StartServerEntry.fetch(request)
  }
}

export default worker
