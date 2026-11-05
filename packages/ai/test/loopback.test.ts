/// <reference types="node" />
// oxlint-disable effect/noAsyncFunction, effect/noGlobals -- exercises native fetch and native socket lifetime independently of Effect's HTTP client
// oxlint-disable-next-line effect/noNodeBuiltinImport -- a real loopback listener proves fetch guard routing and native redirect refusal
import { createServer } from 'node:http'
import { expect, it } from 'vite-plus/test'

it('allows loopback while refusing native automatic redirects out of it', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/redirect') {
      response.writeHead(302, { location: 'https://example.invalid' })
      response.end()
      return
    }
    response.end('local')
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    const address = server.address()
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Node's listener API returns a Unix socket string or TCP address; this test needs the TCP port
    if (address === null || typeof address === 'string') {
      throw new Error('Expected TCP listener')
    }
    const base = `http://127.0.0.1:${address.port}`
    const response = await fetch(base)
    expect(await response.text()).toBe('local')
    await expect(fetch(`${base}/redirect`)).rejects.toThrow('fetch failed')
    const redirect = await fetch(`${base}/redirect`, { redirect: 'manual' })
    expect(redirect.status).toBe(302)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      })
    })
  }
})
