/**
 * Local Booking App ingress.
 *
 * Vite needs the stable `/_booking` base to put its runtime modules behind
 * the Public Site asset dispatcher. This tiny local-only proxy keeps port
 * 3073 usable at the canonical `/:merchantSlug/booking` URL by adding that
 * base only on its private hop to Vite (which runs on 3074).
 */
const vite = Bun.spawn(
  ['/bin/zsh', '-lc', 'BOOKING_VITE_DEV=1 bunx --bun vite dev --port 3074'],
  {
    cwd: decodeURIComponent(new URL('..', import.meta.url).pathname),
    env: { ...process.env, BOOKING_VITE_DEV: '1' },
    stdout: 'inherit',
    stderr: 'inherit'
  }
)

const hopByHopHeaders = ['connection', 'keep-alive', 'transfer-encoding'] as const

const proxyRequest = (request: Request, target: URL): Request => {
  const init: RequestInit = { method: request.method, headers: request.headers }
  if (request.method !== 'GET' && request.method !== 'HEAD' && request.body) {
    init.body = request.body
  }
  return new Request(target, init)
}

const server = Bun.serve({
  port: 3073,
  async fetch(request) {
    const target = new URL(request.url)
    target.port = '3074'
    if (!target.pathname.startsWith('/_booking/')) {
      target.pathname = `/_booking${target.pathname}`
    }

    try {
      const upstream = await fetch(proxyRequest(request, target))
      const headers = new Headers(upstream.headers)
      for (const header of hopByHopHeaders) headers.delete(header)
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers
      })
    } catch {
      return new Response('Booking App is starting. Please retry shortly.', {
        status: 503,
        headers: { 'retry-after': '1' }
      })
    }
  }
})

// oxlint-disable-next-line no-console -- the local endpoint is developer-facing output
console.log(`Booking App local ingress: http://localhost:${server.port}`)

const stop = () => {
  vite.kill()
  server.stop()
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)
