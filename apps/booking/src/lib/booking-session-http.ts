import { Effect, Schema } from 'effect'
import {
  BookingPageUnavailable,
  HoldTimeSlotInput as HoldTimeSlotInputSchema,
  BookingSchedulingRejected,
  CheckoutUnavailable,
  BookingConfirmationRejected,
  CustomerDetails as CustomerDetailsSchema,
  BookingSelectionRejected,
  ServiceSelection as ServiceSelectionSchema,
  BookingSessionGone,
  BookingSessionNotFound,
  CapabilityUnavailable,
  type AuthorizeBookingSessionInput,
  type BookingSession,
  type BookingSessionEntry,
  type BookingJourney,
  type BookingAvailability,
  type TimeSlotHold,
  type HoldTimeSlotInput,
  type ProviderPreference,
  type PresentedBookingSessionCapability,
  type ServiceSelection,
  type CheckoutReview,
  type CustomerDetails,
  type BookingConfirmationResult,
  type ConfirmationReadResult
} from '@b2b-saas-starter/capabilities'
import { BookingAvailabilityQuery } from './booking-scheduling-http-api.ts'

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
  | BookingSelectionRejected
  | BookingSchedulingRejected
  | CheckoutUnavailable
  | BookingConfirmationRejected

type BookingSessionEffect<A, E = never> = Effect.Effect<A, E>

const COOKIE_PREFIX = 'booking_session_'
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/
const CAPABILITY = /^[a-f0-9]{64}$/
const CONFIRMATION_ID = /^[A-Za-z0-9_-]{1,128}$/
const CONFIRMATION_TOKEN = /^[a-f0-9]{64}$/

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
  const requestUrl = new URL(request.url)
  const origin = request.headers.get('origin')
  const directLocal =
    (requestUrl.hostname === 'localhost' || requestUrl.hostname === '127.0.0.1') &&
    origin === requestUrl.origin
  if (origin !== publicSiteOrigin && !directLocal) return hiddenNotFound()
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
  readonly selection?: {
    readonly load: (
      session: BookingSession
    ) => BookingSessionEffect<
      BookingJourney,
      BookingSelectionRejected | CapabilityUnavailable
    >
    readonly chooseProvider: (
      session: BookingSession,
      preference: ProviderPreference
    ) => BookingSessionEffect<
      BookingJourney,
      BookingSelectionRejected | CapabilityUnavailable
    >
    readonly chooseServices: (
      session: BookingSession,
      input: ServiceSelection
    ) => BookingSessionEffect<
      BookingJourney,
      BookingSelectionRejected | CapabilityUnavailable
    >
  }
  readonly scheduling?: {
    readonly availability: (
      session: BookingSession,
      input: { readonly from: string; readonly days?: number; readonly now: string }
    ) => BookingSessionEffect<
      BookingAvailability,
      BookingSchedulingRejected | CapabilityUnavailable
    >
    readonly hold: (
      session: BookingSession,
      input: { readonly startsAt: string; readonly now: string }
    ) => BookingSessionEffect<
      TimeSlotHold,
      BookingSchedulingRejected | CapabilityUnavailable
    >
  }
  readonly checkout?: {
    readonly saveCustomerDetails: (
      session: BookingSession,
      details: CustomerDetails,
      input: { readonly now: string }
    ) => BookingSessionEffect<
      CheckoutReview,
      CheckoutUnavailable | CapabilityUnavailable
    >
    readonly review: (
      session: BookingSession,
      input: { readonly now: string }
    ) => BookingSessionEffect<
      CheckoutReview,
      CheckoutUnavailable | CapabilityUnavailable
    >
  }
  readonly confirmation?: {
    readonly confirm: (
      session: BookingSession,
      input: { readonly now: string; readonly traceId: string }
    ) => BookingSessionEffect<
      BookingConfirmationResult,
      BookingConfirmationRejected | CapabilityUnavailable
    >
    readonly read: (input: {
      readonly routeId: string
      readonly token: string
      readonly now: string
    }) => BookingSessionEffect<ConfirmationReadResult, CapabilityUnavailable>
  }
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
  if (error instanceof BookingSchedulingRejected) {
    return withPrivateHeaders(
      Response.json(
        {
          kind: error.reason === 'slot_lost' ? 'slot_lost' : 'not_ready',
          message:
            error.reason === 'slot_lost'
              ? 'That time was just booked'
              : 'Choose your services again to continue'
        },
        { status: 409 }
      )
    )
  }
  if (error instanceof CheckoutUnavailable) {
    return withPrivateHeaders(
      Response.json({ kind: 'hold_expired', message: error.message }, { status: 409 })
    )
  }
  if (error instanceof BookingConfirmationRejected) {
    return withPrivateHeaders(
      Response.json({ kind: error.reason, message: error.message }, { status: 409 })
    )
  }
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

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ]!
  )

const confirmationHtml = (
  confirmation: Extract<ConfirmationReadResult, { kind: 'found' }>['confirmation']
) => {
  const snapshot = confirmation.snapshot
  const services = snapshot.services
    .map(
      (service) =>
        `<li><strong>${escapeHtml(service.name)}</strong><span>${service.durationMinutes} min · ${(service.priceMinor / 100).toLocaleString('en-US', { style: 'currency', currency: service.currency })}</span></li>`
    )
    .join('')
  const status = confirmation.status === 'no_show' ? 'No show' : confirmation.status
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Appointment Confirmation</title><style>body{margin:0;background:#f7f7f8;color:#292929;font:14px system-ui,sans-serif}.rail{box-sizing:border-box;max-width:375px;min-height:100vh;margin:auto;padding:24px 16px;background:white;border-inline:1px solid #e2e3e7}h1{font-size:22px;margin:0 0 6px}.status{color:#2caf00;text-transform:capitalize}.card{margin-top:24px;padding:16px;border-radius:8px;background:#eff0f3}.provider{display:flex;justify-content:space-between;border-bottom:1px solid #d7d9df;padding-bottom:16px}.muted,li span{display:block;color:#747983;font-size:12px}ul{list-style:none;padding:0;margin:16px 0}li{display:flex;justify-content:space-between;gap:12px;margin-top:14px}.row{display:flex;justify-content:space-between;gap:16px;margin-top:16px}.merchant{margin-top:24px;padding-top:20px;border-top:1px solid #e2e3e7}a{color:inherit}</style></head><body><main class="rail"><h1>Appointment Confirmation</h1><div class="status">${escapeHtml(status)}</div><section class="card" aria-label="Appointment details"><div class="provider"><div><strong>${escapeHtml(snapshot.assignedProvider.displayName)}</strong><span class="muted">Provider</span></div><div><strong>${(snapshot.totalMinor / 100).toLocaleString('en-US', { style: 'currency', currency: snapshot.currency })}</strong><span class="muted">Pay in person</span></div></div><ul>${services}</ul><div class="row"><span class="muted">Time</span><time datetime="${escapeHtml(confirmation.startsAt)}">${escapeHtml(confirmation.startsAt)}</time></div><div class="row"><span class="muted">Duration</span><span>${snapshot.durationMinutes} min</span></div><div class="row"><span class="muted">Timezone</span><span>${escapeHtml(snapshot.merchantTimezone)}</span></div><div class="row"><span>Total price</span><strong>${(snapshot.totalMinor / 100).toLocaleString('en-US', { style: 'currency', currency: snapshot.currency })}</strong></div></section><section class="merchant"><strong>${escapeHtml(confirmation.merchant.publicName)}</strong><span class="muted">Merchant</span></section><section class="merchant"><strong>${escapeHtml(snapshot.customerDetails.name)}</strong><span class="muted">${escapeHtml(snapshot.customerDetails.email)}${snapshot.customerDetails.phone ? ` · ${escapeHtml(snapshot.customerDetails.phone)}` : ''}</span></section></main></body></html>`
}

const jsonJourney = (value: BookingJourney): Response =>
  withPrivateHeaders(
    Response.json(value, {
      headers: { 'content-type': 'application/json; charset=utf-8' }
    })
  )

const jsonPrivate = (
  value: BookingAvailability | TimeSlotHold | CheckoutReview
): Response =>
  withPrivateHeaders(
    Response.json(value, {
      headers: { 'content-type': 'application/json; charset=utf-8' }
    })
  )

const readJson = (request: Request): BookingSessionEffect<unknown> =>
  Effect.promise(() => request.json().catch(() => null))

const providerPreferenceFrom = (value: unknown): ProviderPreference | null => {
  if (typeof value !== 'object' || value === null) return null
  const input = value as Record<string, unknown>
  if (input.kind === 'any') return { kind: 'any' }
  if (input.kind === 'specific' && typeof input.providerId === 'string') {
    return { kind: 'specific', providerId: input.providerId }
  }
  return null
}

const servicesFrom = (value: unknown): ServiceSelection | null => {
  try {
    return Schema.decodeUnknownSync(ServiceSelectionSchema)(value)
  } catch {
    return null
  }
}

const holdTimeSlotFrom = (value: unknown): HoldTimeSlotInput | null => {
  try {
    return Schema.decodeUnknownSync(HoldTimeSlotInputSchema)(value)
  } catch {
    return null
  }
}

const customerDetailsFrom = (value: unknown): CustomerDetails | null => {
  try {
    if (typeof value !== 'object' || value === null) return null
    const input = value as Record<string, unknown>
    const normalized = {
      name: typeof input.name === 'string' ? input.name.trim() : input.name,
      email:
        typeof input.email === 'string'
          ? input.email.trim().toLowerCase()
          : input.email,
      phone:
        typeof input.phone === 'string'
          ? input.phone.trim() || null
          : (input.phone ?? null)
    }
    return Schema.decodeUnknownSync(CustomerDetailsSchema)(normalized)
  } catch {
    return null
  }
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

    if (segments.length === 4 && segments[2] === 'confirmations') {
      const routeId = segments[3]
      if (
        request.method !== 'GET' ||
        !routeId ||
        !CONFIRMATION_ID.test(routeId) ||
        !dependencies.confirmation
      )
        return withPrivateHeaders(hiddenNotFound())
      if (!(yield* dependencies.takeRead(`confirmation:${clientKey}`)))
        return withPrivateHeaders(tooManyRequests())
      const cookieName = `confirmation_${routeId}`
      const cookieToken = request.headers
        .get('cookie')
        ?.split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${cookieName}=`))
        ?.slice(cookieName.length + 1)
      const queryToken = url.searchParams.get('token')
      const token = queryToken ?? cookieToken
      if (!token || !CONFIRMATION_TOKEN.test(token))
        return withPrivateHeaders(hiddenNotFound())
      const result = yield* Effect.result(
        dependencies.confirmation.read({ routeId, token, now })
      )
      if (result._tag === 'Failure') return withPrivateHeaders(unavailable())
      if (result.success.kind === 'not_found')
        return withPrivateHeaders(hiddenNotFound())
      if (result.success.kind === 'expired')
        return withPrivateHeaders(
          new Response(
            '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Confirmation expired</title></head><body><main><h1>This Confirmation link has expired</h1><p>Contact the merchant if you still need these Appointment details.</p></main></body></html>',
            { status: 410, headers: { 'content-type': 'text/html; charset=utf-8' } }
          )
        )
      const canonicalPath = `/${encodeURIComponent(merchantSlug)}/booking/confirmations/${encodeURIComponent(routeId)}`
      if (queryToken) {
        const headers = new Headers({ location: canonicalPath })
        headers.append(
          'set-cookie',
          [
            `${cookieName}=${token}`,
            `Path=${canonicalPath}`,
            'Max-Age=86400',
            'HttpOnly',
            url.protocol === 'https:' ? 'Secure' : null,
            'SameSite=Lax'
          ]
            .filter((part): part is string => part !== null)
            .join('; ')
        )
        return withPrivateHeaders(new Response(null, { status: 303, headers }))
      }
      return withPrivateHeaders(
        new Response(confirmationHtml(result.success.confirmation), {
          headers: { 'content-type': 'text/html; charset=utf-8' }
        })
      )
    }

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

    const endpoint = segments.length === 5 ? segments[4] : null
    const authorization = yield* Effect.result(
      dependencies.authorize({
        merchantSlug,
        sessionId,
        capability: presented.capability,
        now,
        allowConfirmedReplay: endpoint === 'confirm'
      })
    )
    if (authorization._tag === 'Failure') {
      return mapSessionFailure(authorization.failure, merchantSlug)
    }
    if (mutation && !(yield* dependencies.takeWrite(`session:${sessionId}`))) {
      return tooManyRequests()
    }

    if (authorization.success.lifecycle === 'consumed' && endpoint !== 'confirm') {
      return expired(merchantSlug)
    }
    if (endpoint === 'selection' && request.method === 'GET') {
      if (!dependencies.selection) return unavailable()
      const result = yield* Effect.result(
        dependencies.selection.load(authorization.success)
      )
      return result._tag === 'Success'
        ? jsonJourney(result.success)
        : mapSessionFailure(result.failure, merchantSlug)
    }
    if (endpoint === 'provider' && request.method === 'POST') {
      if (!dependencies.selection) return unavailable()
      const preference = providerPreferenceFrom(yield* readJson(request))
      if (!preference) return hiddenNotFound()
      const result = yield* Effect.result(
        dependencies.selection.chooseProvider(authorization.success, preference)
      )
      return result._tag === 'Success'
        ? jsonJourney(result.success)
        : mapSessionFailure(result.failure, merchantSlug)
    }
    if (endpoint === 'services' && request.method === 'POST') {
      if (!dependencies.selection) return unavailable()
      const input = servicesFrom(yield* readJson(request))
      if (!input) return hiddenNotFound()
      const result = yield* Effect.result(
        dependencies.selection.chooseServices(authorization.success, input)
      )
      return result._tag === 'Success'
        ? jsonJourney(result.success)
        : mapSessionFailure(result.failure, merchantSlug)
    }
    if (endpoint === 'availability' && request.method === 'GET') {
      if (!dependencies.scheduling) return unavailable()
      const queryResult = yield* Effect.result(
        Schema.decodeUnknownEffect(BookingAvailabilityQuery)(
          Object.fromEntries(url.searchParams)
        )
      )
      if (queryResult._tag === 'Failure') return hiddenNotFound()
      const from = queryResult.success.from ?? now
      const daysInput = queryResult.success.days
      const days = daysInput === undefined ? undefined : Number(daysInput)
      const result = yield* Effect.result(
        dependencies.scheduling.availability(authorization.success, {
          from,
          ...(days === undefined ? {} : { days }),
          now
        })
      )
      return result._tag === 'Success'
        ? jsonPrivate(result.success)
        : mapSessionFailure(result.failure, merchantSlug)
    }
    if (endpoint === 'hold' && request.method === 'POST') {
      if (!dependencies.scheduling) return unavailable()
      const input = holdTimeSlotFrom(yield* readJson(request))
      if (!input) return hiddenNotFound()
      const result = yield* Effect.result(
        dependencies.scheduling.hold(authorization.success, {
          startsAt: input.startsAt,
          now
        })
      )
      return result._tag === 'Success'
        ? jsonPrivate(result.success)
        : mapSessionFailure(result.failure, merchantSlug)
    }
    if (endpoint === 'customer-details' && request.method === 'POST') {
      if (!dependencies.checkout) return unavailable()
      const details = customerDetailsFrom(yield* readJson(request))
      if (!details) {
        return withPrivateHeaders(
          Response.json(
            { kind: 'invalid_customer_details', message: 'Check your details' },
            { status: 422 }
          )
        )
      }
      const result = yield* Effect.result(
        dependencies.checkout.saveCustomerDetails(authorization.success, details, {
          now
        })
      )
      return result._tag === 'Success'
        ? jsonPrivate(result.success)
        : mapSessionFailure(result.failure, merchantSlug)
    }
    if (endpoint === 'checkout' && request.method === 'GET') {
      if (!dependencies.checkout) return unavailable()
      const result = yield* Effect.result(
        dependencies.checkout.review(authorization.success, { now })
      )
      return result._tag === 'Success'
        ? jsonPrivate(result.success)
        : mapSessionFailure(result.failure, merchantSlug)
    }
    if (endpoint === 'confirm' && request.method === 'POST') {
      const input = yield* readJson(request)
      if (
        typeof input !== 'object' ||
        input === null ||
        Array.isArray(input) ||
        Object.keys(input).length !== 0
      ) {
        return hiddenNotFound()
      }
      if (!dependencies.confirmation) return unavailable()
      const traceId = request.headers.get('cf-ray') ?? `trace_${crypto.randomUUID()}`
      const result = yield* Effect.result(
        dependencies.confirmation.confirm(authorization.success, { now, traceId })
      )
      if (result._tag === 'Failure')
        return mapSessionFailure(result.failure, merchantSlug)
      const confirmed = result.success
      const location = `/${encodeURIComponent(merchantSlug)}/booking/confirmations/${encodeURIComponent(confirmed.access.routeId)}?token=${encodeURIComponent(confirmed.access.token)}`
      const response = Response.json({
        appointment: confirmed.appointment,
        access: {
          routeId: confirmed.access.routeId,
          tokenVersion: confirmed.access.tokenVersion,
          signingKeyId: confirmed.access.signingKeyId,
          expiresAt: confirmed.access.expiresAt
        },
        outboxId: confirmed.outboxId,
        replayed: confirmed.replayed,
        location
      })
      return withPrivateHeaders(response)
    }
    return withPrivateHeaders(yield* dependencies.fallback(request))
  })
