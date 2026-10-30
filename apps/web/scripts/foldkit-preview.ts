/* oxlint-disable effect/noNodeBuiltinImport -- Vite's Node host owns HTTP and socket adaptation. */
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Exit, Predicate, Scope } from 'effect'
import { HttpServerRequest, HttpServerResponse } from 'effect/http'
import { resolveRequestUrl } from 'foldkit/experimental/server'
import { isRunnableDevEnvironment, type Plugin, type ViteDevServer } from 'vite-plus'
import { isProtocolPath } from '../src/protocol-path'

type Fetch = (request: Request) => Promise<Response>
type ProtocolModule = { readonly serveProtocolRequest: Fetch }
type FetchModule = ProtocolModule & { readonly default: { readonly fetch: Fetch } }

function isProtocolModule(value: unknown): value is ProtocolModule {
  return (
    Predicate.hasProperty(value, 'serveProtocolRequest') &&
    Predicate.isFunction(value.serveProtocolRequest)
  )
}

function isFetchModule(value: unknown): value is FetchModule {
  return (
    isProtocolModule(value) &&
    Predicate.hasProperty(value, 'default') &&
    Predicate.hasProperty(value.default, 'fetch') &&
    Predicate.isFunction(value.default.fetch)
  )
}

async function nodeListener(
  fetch: Fetch,
  origin: string,
  server: NonNullable<ViteDevServer['httpServer']>
) {
  const scope = Scope.makeUnsafe()
  const application = Effect.gen(function* () {
    const incoming = yield* HttpServerRequest.HttpServerRequest
    const url = resolveRequestUrl(incoming.url, origin)
    if (url === undefined) {
      return HttpServerResponse.empty({ status: 400 })
    }
    if (['CONNECT', 'TRACE', 'TRACK'].includes(incoming.method)) {
      return HttpServerResponse.empty({
        status: 405,
        headers: { Allow: 'GET, HEAD, POST, OPTIONS' }
      })
    }
    const signal = yield* Effect.abortSignal
    const request = yield* HttpServerRequest.toWeb(incoming, { signal })
    const response = yield* Effect.promise(() => fetch(new Request(url, request)))
    return HttpServerResponse.fromWeb(response)
  })
  const listener = await Effect.runPromise(
    NodeHttpServer.makeHandler(application, { scope })
  )
  server.once('close', () => {
    void Effect.runPromise(Scope.close(scope, Exit.void))
  })
  return listener
}

/** Foldkit owns pages; application JSON protocols bypass HTML negotiation. */
export function foldkitPreview(serverOutDir: string): Plugin {
  return {
    name: 'starter:foldkit-http-host',
    async configureServer(server) {
      if (server.httpServer === null) {
        return
      }
      const listener = await nodeListener(
        async (request) => {
          const environment = server.environments.ssr
          assert(
            isRunnableDevEnvironment(environment),
            'SSR environment must be runnable in local development.'
          )
          const entry: unknown = await environment.runner.import('/src/entry.server.ts')
          assert(
            isProtocolModule(entry),
            'SSR entry must export the application protocol handler.'
          )
          return entry.serveProtocolRequest(request)
        },
        `http://localhost:${server.config.server.port}`,
        server.httpServer
      )
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? '/').split('?')[0] ?? '/'
        if (isProtocolPath(path)) {
          listener(request, response)
        } else {
          next()
        }
      })
    },
    async configurePreviewServer(server) {
      const entry: unknown = await import(
        /* @vite-ignore */ pathToFileURL(
          resolve(server.config.root, serverOutDir, 'fetch.js')
        ).href
      )
      assert(
        isFetchModule(entry),
        'Foldkit build must export page and protocol handlers; build before preview.'
      )
      const listener = await nodeListener(
        (request) =>
          isProtocolPath(new URL(request.url).pathname)
            ? entry.serveProtocolRequest(request)
            : entry.default.fetch(request),
        `http://localhost:${server.config.preview.port}`,
        server.httpServer
      )
      return () => {
        server.middlewares.use(listener)
      }
    }
  }
}
