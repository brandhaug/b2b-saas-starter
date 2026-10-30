import { env } from 'cloudflare:workers'
import { Responded } from 'foldkit/experimental/server'
import { renderPage as render } from '../../src/entry.server'
export {
  renderDocument,
  serveProtocolRequest,
  connectAssistantConversation
} from '../../src/entry.server'

// Only the dedicated workerd test build resolves this entry.
export async function renderPage(request: Request) {
  const gate = env.DOCS_RENDER_GATE
  if (gate !== undefined) {
    const response = await gate.fetch('https://render.test/document', {
      headers: { 'x-docs-request': request.url }
    })
    if (!response.ok) {
      return Responded(new Response('Document unavailable', { status: 500 }))
    }
  }
  return render(request)
}
