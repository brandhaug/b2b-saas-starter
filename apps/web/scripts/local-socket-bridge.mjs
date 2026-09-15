/* oxlint-disable effect/noTryCatch -- Node upgrade handling is a local platform adapter. */
import { WebSocketServer } from 'ws'
import { coupleWebSocket } from 'miniflare'

/** Only the normal authenticated application boundary may return an accepted socket. */
export function installAssistantSocketBridge(server, connect) {
  const sockets = new WebSocketServer({ noServer: true })
  async function upgrade(request, socket, head) {
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`)
    const match = /^\/api\/assistant\/([^/]+)\/connect$/.exec(url.pathname)
    if (match === null) {
      return
    }
    socket.on('error', () => socket.destroy())
    try {
      const headers = new Headers()
      for (let index = 0; index < request.rawHeaders.length; index += 2) {
        headers.append(request.rawHeaders[index], request.rawHeaders[index + 1])
      }
      const response = await connect(
        new Request(url, { headers }),
        decodeURIComponent(match[1])
      )
      if (response.status !== 101 || !response.webSocket) {
        socket.end(
          `HTTP/1.1 ${response.status === 101 ? 503 : response.status} Connection refused\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
        )
        return
      }
      if (socket.destroyed) {
        response.webSocket.close(1000, 'Client disconnected')
        return
      }
      sockets.handleUpgrade(request, socket, head, (client) => {
        void coupleWebSocket(client, response.webSocket).catch(() => client.terminate())
      })
    } catch {
      socket.end(
        'HTTP/1.1 503 Connection unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'
      )
    }
  }
  server.on('upgrade', upgrade)
  return () => {
    server.off('upgrade', upgrade)
    for (const client of sockets.clients) {
      client.terminate()
    }
    sockets.close()
  }
}
