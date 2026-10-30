// Deployment entry: native Durable Object imports stay outside Node SSR.
import pages from 'virtual:foldkit/fetch'
import { serveProtocolRequest } from './entry.server'
import { isProtocolPath } from './protocol-path'
export { WorkspaceAssistantConversation } from './lib/assistant/conversation-host'

export default {
  fetch(request: Request): Promise<Response> {
    return isProtocolPath(new URL(request.url).pathname)
      ? serveProtocolRequest(request)
      : pages.fetch(request)
  }
}
