/**
 * Local Booking App ingress.
 *
 * Vite needs the stable `/_booking` base to put its runtime modules behind
 * the Public Site asset dispatcher. This tiny local-only proxy keeps port
 * 3073 usable at the canonical `/:merchantSlug/booking` URL while proxying
 * assets and pages to Vite on 3074.
 */
import { bookingProxyRequest, bookingVitePath } from './lib/dev-ingress.ts'
import {
  newTraceId,
  reportOperationalError,
  TRACE_HEADER
} from '@b2b-saas-starter/logger'

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

const server = Bun.serve({
  port: 3073,
  async fetch(request) {
    const target = new URL(request.url)
    target.port = '3074'
    target.pathname = bookingVitePath(target.pathname)

    try {
      const upstream = await fetch(await bookingProxyRequest(request, target))
      const headers = new Headers(upstream.headers)
      for (const header of hopByHopHeaders) headers.delete(header)
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers
      })
    } catch (error) {
      await reportOperationalError({
        service: 'booking-dev-ingress',
        event: 'booking.dev_ingress_unavailable',
        traceId: request.headers.get(TRACE_HEADER) ?? newTraceId(),
        pathname: new URL(request.url).pathname,
        failure: 'vite_proxy_exception',
        error: error instanceof Error ? error.message : String(error)
      })
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
  void server.stop()
}

process.on('SIGINT', stop)
process.on('SIGTERM', stop)
