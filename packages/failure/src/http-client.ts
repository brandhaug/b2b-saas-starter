import { Layer } from 'effect'
import { FetchHttpClient, type HttpClient } from 'effect/http'

/**
 * The outbound transport provider adapters (Stripe, OpenAI) take from their
 * environment: Effect's fetch client, provided once where an application
 * composes them. The global is read per request because Effect caches the
 * default `FetchHttpClient.Fetch` on first use, and the AI package's test
 * network guard replaces the global around every test.
 *
 * A `FetchHttpClient.Fetch` on the requesting fiber overrides this one; that
 * is how {@link wireHttpClient} reaches a transport composed inside a Live
 * layer.
 */
export const PlatformHttpClientLive: Layer.Layer<HttpClient.HttpClient> =
  FetchHttpClient.layer.pipe(
    Layer.provide(
      Layer.succeed(FetchHttpClient.Fetch)((input, init) =>
        // oxlint-disable-next-line effect/noGlobals -- the platform fetch is the production transport
        globalThis.fetch(input, init)
      )
    )
  )

/** One outbound request as a wire fixture reads it. */
export type WireRequest = {
  readonly method: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
  readonly redirect: RequestRedirect
  readonly signal: AbortSignal
}

/**
 * A test transport answering every request from `respond`, so no test patches
 * the global fetch. It provides `HttpClient` for adapters that take it from
 * the environment and `FetchHttpClient.Fetch` for a
 * {@link PlatformHttpClientLive} composed inside a Live layer. Requests still
 * pass through Effect's fetch client, so `redirect` and the abort `signal`
 * are the ones the adapter set.
 */
export function wireHttpClient(
  respond: (url: string, request: WireRequest) => Response | Promise<Response>
): Layer.Layer<HttpClient.HttpClient> {
  function wire(input: RequestInfo | URL, init?: RequestInit) {
    const request = new Request(input, init)
    return request.text().then((body) =>
      respond(request.url, {
        method: request.method,
        headers: Object.fromEntries(request.headers),
        body,
        redirect: request.redirect,
        signal: request.signal
      })
    )
  }
  return FetchHttpClient.layer.pipe(
    Layer.provideMerge(Layer.succeed(FetchHttpClient.Fetch)(wire))
  )
}
