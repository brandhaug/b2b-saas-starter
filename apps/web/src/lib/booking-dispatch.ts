import {
  newTraceId,
  reportOperationalError,
  TRACE_HEADER
} from '@b2b-saas-starter/logger'

export type BookingServiceBinding = {
  readonly fetch: (request: Request) => Promise<Response>
}

export type BookingIngressEnv = {
  readonly BOOKING?: BookingServiceBinding
}

const RESERVED_PUBLIC_SLUGS = new Set([
  'docs',
  'blog',
  'faq',
  'help',
  'changelog',
  'pricing',
  'privacy',
  'terms',
  'booking',
  'api',
  'assets',
  '_booking',
  'admin',
  'sign-in',
  'app',
  'www'
])

const isMerchantSlug = (value: string): boolean =>
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && !RESERVED_PUBLIC_SLUGS.has(value)

const merchantBookingPath = (pathname: string): boolean => {
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length < 2 || segments[1] !== 'booking') return false
  try {
    return isMerchantSlug(decodeURIComponent(segments[0] ?? ''))
  } catch {
    return false
  }
}

const bookingFirstPath = (pathname: string): boolean => {
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length !== 2 || segments[0] !== 'booking') return false
  try {
    return isMerchantSlug(decodeURIComponent(segments[1] ?? ''))
  } catch {
    return false
  }
}

/**
 * The Public Site owns the canonical ingress. This deliberately uses only
 * path shape and the reserved-slug set: merchant resolution belongs to the
 * Booking App after the service-boundary hop.
 */
export const isBookingRequest = (url: URL): boolean =>
  url.pathname === '/virtual:stylex.css' ||
  url.pathname.startsWith('/_booking/') ||
  bookingFirstPath(url.pathname) ||
  merchantBookingPath(url.pathname)

const bookingUnavailable = (traceId: string): Response =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Booking temporarily unavailable</title></head><body><main><h1>Booking temporarily unavailable</h1><p>Please try again shortly.</p><p>Request trace: ${traceId}</p></main></body></html>`,
    {
      status: 503,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'retry-after': '60',
        [TRACE_HEADER]: traceId
      }
    }
  )

export const dispatchBookingRequest = async (
  request: Request,
  env: BookingIngressEnv,
  fallback: () => Promise<Response>
): Promise<Response> => {
  if (!isBookingRequest(new URL(request.url))) return fallback()

  const traceId = request.headers.get(TRACE_HEADER) ?? newTraceId()
  if (!env.BOOKING) {
    await reportOperationalError({
      service: 'web',
      event: 'booking.ingress_unavailable',
      traceId,
      pathname: new URL(request.url).pathname,
      failure: 'missing_service_binding'
    })
    return bookingUnavailable(traceId)
  }

  const headers = new Headers(request.headers)
  headers.set(TRACE_HEADER, traceId)

  try {
    // Constructing from the original request retains its URL, method, and
    // body while adding the ingress-owned trace header for the Booking App.
    return await env.BOOKING.fetch(new Request(request, { headers }))
  } catch (error) {
    // A thrown service-binding error means no Booking App response exists to
    // relay. Keep the failure isolated to the booking boundary.
    await reportOperationalError({
      service: 'web',
      event: 'booking.ingress_unavailable',
      traceId,
      pathname: new URL(request.url).pathname,
      failure: 'service_binding_exception',
      error: error instanceof Error ? error.message : String(error)
    })
    return bookingUnavailable(traceId)
  }
}
