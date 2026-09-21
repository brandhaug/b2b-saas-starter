/* oxlint-disable effect/noNodeBuiltinImport -- Vite is the local Node platform boundary. */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isRunnableDevEnvironment, type Plugin } from 'vite-plus'
import { installAssistantSocketBridge } from './local-socket-bridge.mjs'
import type * as SocketBoundary from '../src/lib/server/assistant-conversation-socket'

type Entry = Pick<typeof SocketBoundary, 'connectAssistantConversation'>

export function localAssistantSockets(): Plugin {
  return {
    name: 'b2b-starter:local-assistant-sockets',
    configureServer(server) {
      if (server.httpServer === null) {
        return
      }
      const close = installAssistantSocketBridge(
        server.httpServer,
        async (request, id) => {
          const environment = server.environments.ssr
          if (!isRunnableDevEnvironment(environment)) {
            return new Response(null, { status: 503 })
          }
          const boundary: Entry = await environment.runner.import(
            '/src/lib/server/assistant-conversation-socket.ts'
          )
          return boundary.connectAssistantConversation(request, id)
        }
      )
      server.httpServer.once('close', close)
    },
    configurePreviewServer(server) {
      const directory =
        server.config.environments.ssr?.build.outDir ??
        resolve(server.config.build.outDir, 'server')
      const entryUrl = pathToFileURL(
        resolve(server.config.root, directory, 'server.js')
      ).href
      const close = installAssistantSocketBridge(
        server.httpServer,
        async (request, id) => {
          const boundary: Entry = await import(/* @vite-ignore */ entryUrl)
          return boundary.connectAssistantConversation(request, id)
        }
      )
      server.httpServer.once('close', close)
    }
  }
}
