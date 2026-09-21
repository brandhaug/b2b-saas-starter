// @vitest-environment node
/* oxlint-disable effect/noNodeBuiltinImport -- The regression test owns Node and workerd sockets. */
import { createServer } from 'node:http'
import { once } from 'node:events'
import {
  Miniflare,
  convertV4MiniflareOptions,
  Request as MiniflareRequest
} from 'miniflare'
import { WebSocket } from 'ws'
import { expect, it } from 'vite-plus/test'
import { installAssistantSocketBridge } from './local-socket-bridge.mjs'

it('checks the application boundary before bridging real saved-history socket frames', async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      cf: false,
      compatibilityDate: '2026-09-15',
      script: `export default {fetch(request) {
      const pair = new WebSocketPair(); pair[1].accept();
      pair[1].send(JSON.stringify({type:'conversation_snapshot',history:{items:[]}}));
      pair[1].addEventListener('message', event => pair[1].send(event.data));
      return new Response(null,{status:101,webSocket:pair[0]});
    }}`
    })
  )
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Node server.address returns a socket path or address record
  if (address === null || typeof address === 'string') {
    throw new Error('Missing test listener')
  }
  const origin = `http://127.0.0.1:${address.port}`
  let accepted = 0
  const close = installAssistantSocketBridge(
    server,
    async (request, conversationId) => {
      expect(conversationId).toBe('conversation-test')
      if (request.headers.get('origin') !== origin) {
        return new Response(null, { status: 403 })
      }
      if (request.headers.get('cookie') !== 'test-session=present') {
        return new Response(null, { status: 401 })
      }
      accepted++
      return mf.dispatchFetch(
        new MiniflareRequest(request.url, {
          headers: Object.fromEntries(request.headers)
        })
      )
    }
  )
  const url = `${origin.replace('http:', 'ws:')}/api/assistant/conversation-test/connect`
  try {
    const deniedRequests: ReadonlyArray<readonly [Record<string, string>, number]> = [
      [{ origin }, 401],
      [{ origin: 'https://other.test', cookie: 'test-session=present' }, 403]
    ]
    for (const [headers, status] of deniedRequests) {
      const denied = new WebSocket(url, { headers })
      const [, response] = await once(denied, 'unexpected-response')
      expect(response.statusCode).toBe(status)
      response.resume()
      denied.terminate()
      denied.on('error', () => undefined)
    }
    expect(accepted).toBe(0)
    const client = new WebSocket(url, {
      origin,
      headers: { cookie: 'test-session=present' }
    })
    const first = once(client, 'message')
    const [snapshot] = await first
    expect(JSON.parse(snapshot.toString())).toEqual({
      type: 'conversation_snapshot',
      history: { items: [] }
    })
    const echo = once(client, 'message')
    client.send('resume-observation')
    const [message] = await echo
    expect(message.toString()).toBe('resume-observation')
    expect(accepted).toBe(1)
    client.close()
    await once(client, 'close')
  } finally {
    close()
    await mf.dispose()
    server.close()
    await once(server, 'close')
  }
})
