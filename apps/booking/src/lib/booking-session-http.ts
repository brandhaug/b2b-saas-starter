import { Effect, Schema } from 'effect'
import {
  BookingPageUnavailable,
  BookingSessionGone,
  BookingSessionNotFound,
  CapabilityUnavailable,
  type AuthorizeBookingSessionInput,
  type BookingSession,
  type BookingSessionEntry,
  type PresentedBookingSessionCapability
} from '@b2b-saas-starter/capabilities'

export class InvalidBookingSessionCookie extends Schema.TaggedErrorClass<InvalidBookingSessionCookie>()(
  'InvalidBookingSessionCookie',
  { message: Schema.String }
) {}

/*
 * This is the first-party HTTP contract for Booking Session ingress. Business
 * failures stay in Effect's typed channel until this adapter deliberately maps
 * them to the settled non-disclosing HTTP responses.
 */
type BookingSessionHttpFailure =
  | BookingPageUnavailable
  | BookingSessionNotFound
  | BookingSessionGone
  | CapabilityUnavailable
  | InvalidBookingSessionCookie

type BookingSessionEffect<A, E = never> = Effect.Effect<A, E>

const COOKIE_PREFIX = 'booking_session_'
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/
const CAPABILITY = /^[a-f0-9]{64}$/

export const bookingSessionCookie = (input: {
  readonly sessionId: string
  readonly merchantSlug: string
  readonly capability: string
  readonly absoluteExpiresAt: string
  readonly now: string
  readonly secure: boolean
}): BookingSessionEffect<string, InvalidBookingSessionCookie> => {
  if (!SESSION_ID.test(input.sessionId) || !CAPABILITY.test(input.capability)) {
    return Effect.fail(
      new InvalidBookingSessionCookie({
        message: 'Invalid Booking Session cookie material'
      })
    )
  }
  const maxAge = Math.max(
    0,
    Math.floor(
      (new Date(input.absoluteExpiresAt).getTime() - new Date(input.now).getTime()) /
        1000
    )
  )
  return Effect.succeed(
    [
      `${COOKIE_PREFIX}${input.sessionId}=${input.capability}`,
      `Path=/${input.merchantSlug}/booking`,
      `Max-Age=${maxAge}`,
      'HttpOnly',
      input.secure ? 'Secure' : null,
      'SameSite=Lax'
    ]
      .filter((part): part is string => part !== null)
      .join('; ')
  )
}

export const readBookingSessionCapabilities = (
  cookieHeader: string | null
): readonly PresentedBookingSessionCapability[] => {
  if (!cookieHeader) return []
  const candidates: PresentedBookingSessionCapability[] = []
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 1) continue
    const name = part.slice(0, separator).trim()
    const capability = part.slice(separator + 1).trim()
    if (!name.startsWith(COOKIE_PREFIX) || !CAPABILITY.test(capability)) continue
    const sessionId = name.slice(COOKIE_PREFIX.length)
    if (SESSION_ID.test(sessionId)) candidates.push({ sessionId, capability })
  }
  return candidates
}

const hiddenNotFound = (): Response =>
  new Response('Not found', {
    status: 404,
    headers: { 'cache-control': 'private, no-store' }
  })

export const validatePrivateMutationRequest = (
  request: Request,
  publicSiteOrigin: string
): Response | null => {
  if (request.method === 'GET' || request.method === 'HEAD') {
    return new Response('Method not allowed', { status: 405 })
  }
  if (request.headers.get('origin') !== publicSiteOrigin) return hiddenNotFound()
  const fetchSite = request.headers.get('sec-fetch-site')
  if (fetchSite !== null && fetchSite !== 'same-origin') return hiddenNotFound()
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim()
  if (contentType !== 'application/json') {
    return new Response('Unsupported media type', { status: 415 })
  }
  return null
}

export type BookingSessionHttpDependencies = {
  readonly publicSiteOrigin: string
  readonly enter: (input: {
    readonly merchantSlug: string
    readonly candidates: readonly PresentedBookingSessionCapability[]
    readonly now: string
  }) => BookingSessionEffect<
    BookingSessionEntry,
    BookingPageUnavailable | CapabilityUnavailable
  >
  readonly authorize: (
    input: AuthorizeBookingSessionInput
  ) => BookingSessionEffect<
    BookingSession,
    BookingSessionNotFound | BookingSessionGone | CapabilityUnavailable
  >
  readonly takeRead: (key: string) => BookingSessionEffect<boolean>
  readonly takeWrite: (key: string) => BookingSessionEffect<boolean>
  readonly fallback: (request: Request) => BookingSessionEffect<Response>
  readonly now?: () => string
}

const tooManyRequests = (): Response =>
  new Response('Too many requests', {
    status: 429,
    headers: {
      'cache-control': 'private, no-store',
      'retry-after': '60'
    }
  })

const unavailable = (): Response =>
  new Response('Booking temporarily unavailable', {
    status: 503,
    headers: { 'cache-control': 'private, no-store', 'retry-after': '60' }
  })

const expired = (merchantSlug: string): Response =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Booking Session expired</title></head><body><main><h1>This Booking Session has expired</h1><a href="/${merchantSlug}/booking">Start again</a></main></body></html>`,
    {
      status: 410,
      headers: {
        'cache-control': 'private, no-store',
        'content-type': 'text/html; charset=utf-8',
        'referrer-policy': 'no-referrer'
      }
    }
  )

const mapSessionFailure = (
  error: BookingSessionHttpFailure,
  merchantSlug: string
): Response => {
  if (error instanceof BookingSessionGone) return expired(merchantSlug)
  if (error instanceof CapabilityUnavailable) return unavailable()
  return hiddenNotFound()
}

const safeSegments = (pathname: string): readonly string[] | null => {
  try {
    return pathname.split('/').filter(Boolean).map(decodeURIComponent)
  } catch {
    return null
  }
}

const withPrivateHeaders = (response: Response): Response => {
  const headers = new Headers(response.headers)
  headers.set('cache-control', 'private, no-store')
  headers.set('referrer-policy', 'no-referrer')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}

export const handleBookingSessionRequest = (
  request: Request,
  dependencies: BookingSessionHttpDependencies
): BookingSessionEffect<Response> =>
  Effect.gen(function* () {
    const url = new URL(request.url)
    const segments = safeSegments(url.pathname)
    if (!segments || segments[1] !== 'booking') {
      return yield* dependencies.fallback(request)
    }
    const merchantSlug = segments[0]
    if (!merchantSlug) return hiddenNotFound()
    const now = dependencies.now?.() ?? new Date().toISOString()
    const clientKey = request.headers.get('cf-connecting-ip') ?? `path:${url.pathname}`

    if (segments.length === 2) {
      if (request.method !== 'GET') return hiddenNotFound()
      if (!(yield* dependencies.takeRead(`entry:${clientKey}`))) {
        return tooManyRequests()
      }
      const entryResult = yield* Effect.result(
        dependencies.enter({
          merchantSlug,
          candidates: readBookingSessionCapabilities(request.headers.get('cookie')),
          now
        })
      )
      if (entryResult._tag === 'Failure') {
        return mapSessionFailure(entryResult.failure, merchantSlug)
      }
      const entry = entryResult.success
      const headers = new Headers({
        location: `/${merchantSlug}/booking/session/${entry.session.id}`,
        'cache-control': 'private, no-store',
        'referrer-policy': 'no-referrer'
      })
      if (entry.kind === 'created') {
        const cookieResult = yield* Effect.result(
          bookingSessionCookie({
            sessionId: entry.session.id,
            merchantSlug,
            capability: entry.capability,
            absoluteExpiresAt: entry.session.absoluteExpiresAt,
            now,
            secure: url.protocol === 'https:'
          })
        )
        if (cookieResult._tag === 'Failure') {
          return mapSessionFailure(cookieResult.failure, merchantSlug)
        }
        headers.append('set-cookie', cookieResult.success)
      }
      return new Response(null, { status: 303, headers })
    }

    if (segments.length < 4 || segments[2] !== 'session') {
      return yield* dependencies.fallback(request)
    }
    const sessionId = segments[3]
    if (!sessionId || !SESSION_ID.test(sessionId)) return hiddenNotFound()
    if (!(yield* dependencies.takeRead(`private:${clientKey}`))) {
      return tooManyRequests()
    }

    const mutation = request.method !== 'GET' && request.method !== 'HEAD'
    if (mutation) {
      const invalid = validatePrivateMutationRequest(
        request,
        dependencies.publicSiteOrigin
      )
      if (invalid) return invalid
    }
    const presented = readBookingSessionCapabilities(
      request.headers.get('cookie')
    ).find((candidate) => candidate.sessionId === sessionId)
    if (!presented) return hiddenNotFound()

    const authorization = yield* Effect.result(
      dependencies.authorize({
        merchantSlug,
        sessionId,
        capability: presented.capability,
        now
      })
    )
    if (authorization._tag === 'Failure') {
      return mapSessionFailure(authorization.failure, merchantSlug)
    }
    if (mutation && !(yield* dependencies.takeWrite(`session:${sessionId}`))) {
      return tooManyRequests()
    }
    return withPrivateHeaders(yield* dependencies.fallback(request))
  })
