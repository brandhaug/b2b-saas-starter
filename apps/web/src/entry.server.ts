import {
  type RenderedApplication,
  type EntryResult,
  type DocumentAssets,
  Rendered,
  Responded,
  renderToString,
  renderDocument as document
} from 'foldkit/experimental/server'
import { createWebHandler } from './server'
import { serverProgram } from './foldkit/program'
import { flagsForPage } from './foldkit/page-flags'
import { webRuntime } from './lib/observability'
import { type PageData } from './http/page-contract'
import { documentHead } from './foldkit/document-head'
import { bindPresentationReader } from './lib/i18n'
import { requestPresentation } from './lib/server/i18n-context'

export { connectAssistantConversation } from './server'

const handler = createWebHandler()
bindPresentationReader(requestPresentation)
const documentMetadata = new WeakMap<
  RenderedApplication,
  {
    readonly presentation: PageData['presentation']
    readonly head: string
  }
>()

function attribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

/** Bypass HTML content negotiation for protocols owned by the application. */
export function serveProtocolRequest(request: Request): Promise<Response> {
  return handler.fetch(request, () => new Response(null, { status: 404 }))
}

export async function renderPage(request: Request): Promise<EntryResult> {
  let application: RenderedApplication | undefined
  const response = await handler.fetch(
    request,
    async ({ request: pageRequest, data }) => {
      const flags = flagsForPage(new URL(pageRequest.url), data)
      application = await webRuntime.runPromise(
        renderToString(serverProgram, {
          flags
        })
      )
      documentMetadata.set(application, {
        presentation: data.presentation,
        head: documentHead(flags)
      })
      return new Response(null, {
        status: flags.page._tag === 'Error' ? flags.page.flags.status : data.status
      })
    }
  )
  return application === undefined
    ? Responded(response)
    : Rendered(application, { status: response.status, headers: response.headers })
}

export function renderDocument(
  application: RenderedApplication,
  assets: DocumentAssets
): string {
  const metadata = documentMetadata.get(application)
  const html = document(application, assets, {
    head: `<meta name="referrer" content="strict-origin"><meta name="theme-color" content="#1e1e2e"><link rel="icon" type="image/png" href="/assets/favicon.png">${metadata?.head ?? ''}`
  })
  if (metadata === undefined) {
    return html
  }
  documentMetadata.delete(application)
  const settings = metadata.presentation
  const timeZone = attribute(settings.timeZone)
  return html.replace(
    '<html ',
    `<html data-time-zone="${timeZone}" data-authenticated="${String(settings.authenticated)}" data-needs-time-zone="${String(settings.needsTimeZone)}" `
  )
}
