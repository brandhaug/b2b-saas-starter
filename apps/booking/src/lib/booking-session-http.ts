import { Effect, Schema } from 'effect'
import {
  BookingPageUnavailable,
  BookingPartyConflict,
  BookingPartyNotFound,
  BookingRequestMaterial as BookingRequestMaterialSchema,
  HoldTimeSlotInput as HoldTimeSlotInputSchema,
  CoordinatedHoldInput as CoordinatedHoldInputSchema,
  BookingSchedulingRejected,
  CheckoutUnavailable,
  CheckoutCommandRejected,
  CheckoutReviewUnavailable,
  BookingConfirmationProcessing,
  BookingConfirmationRejected,
  BookingSelectionRejected,
  ServiceSelection as ServiceSelectionSchema,
  BookingSessionGone,
  BookingSessionNotFound,
  CapabilityUnavailable,
  type AuthorizeBookingSessionInput,
  type BookingSession,
  type BookingParty,
  type BookingRequestMaterial,
  type BookingSessionEntry,
  type BookingJourney,
  type BookingAvailability,
  type TimeSlotHold,
  type HoldTimeSlotInput,
  type CoordinatedHoldInput,
  type ProviderPreference,
  type PresentedBookingSessionCapability,
  type ServiceSelection,
  type CheckoutReview,
  type CheckoutPreparation,
  type PartyCheckoutReview,
  type CheckoutPolicyAcceptance,
  type MarketingConsent,
  type BookingCheckoutFailure,
  type CustomerDetails,
  type CustomerDetailsIssue,
  normalizeCustomerDetails,
  type BookingConfirmationResult,
  type ConfirmationReadResult,
  type CancellationResult
} from '@b2b-saas-starter/capabilities/booking'
import {
  InvalidQuoteMaterial,
  PricingQuoteNotFound,
  QuoteUnconfirmable
} from '@b2b-saas-starter/capabilities/pricing'
import type {
  OnlinePaymentMethod,
  PaymentMethodEligibility,
  PaymentView
} from '@b2b-saas-starter/capabilities/payments'
import type { GiftCardReservation } from '@b2b-saas-starter/capabilities/gift-cards'
import { BookingAvailabilityQuery } from './booking-scheduling-http-api.ts'
import {
  canonicalizeBookingRequest,
  matchCanonicalBookingRoute,
  type BookingEmbedding
} from './booking-route-contract.ts'
import {
  parseBookingLocale,
  translateBookingMessage,
  type BookingLocale
} from '../localization/booking-localization.ts'

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
  | BookingPartyConflict
  | BookingPartyNotFound
  | BookingSchedulingRejected
  | CheckoutUnavailable
  | BookingCheckoutFailure
  | BookingConfirmationProcessing
  | BookingConfirmationRejected

type BookingSessionEffect<A, E = never> = Effect.Effect<A, E>

const COOKIE_PREFIX = 'booking_session_'
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/
const CAPABILITY = /^[a-f0-9]{64}$/
const CONFIRMATION_ID = /^[A-Za-z0-9_-]{1,128}$/
const CONFIRMATION_TOKEN = /^[a-f0-9]{64}$/
const QuoteAcceptanceInput = Schema.Struct({ quoteId: Schema.String })
const PolicyAcceptanceInput = Schema.Struct({ policyId: Schema.String })
const MarketingConsentInput = Schema.Struct({
  bookingRequestId: Schema.String,
  channel: Schema.Literals(['email', 'sms']),
  granted: Schema.Boolean
})
const RescheduleReplacementInput = Schema.Struct({
  hold: Schema.Struct({
    id: Schema.String,
    providerId: Schema.String,
    providerDisplayName: Schema.String,
    startsAt: Schema.String,
    endsAt: Schema.String,
    expiresAt: Schema.String
  }),
  quote: Schema.Struct({
    id: Schema.String,
    version: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
    totalMinor: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
    currency: Schema.String,
    acceptedAt: Schema.String,
    expiresAt: Schema.String
  }),
  policyAcceptance: Schema.Struct({
    policyId: Schema.String,
    policyVersion: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
    disclosureSnapshot: Schema.String,
    acceptedAt: Schema.String
  }),
  settlement: Schema.Struct({
    kind: Schema.Literals(['unchanged', 'refund', 'additional_collection']),
    amountMinor: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
    referenceId: Schema.NullOr(Schema.String)
  }),
  reminderAt: Schema.NullOr(Schema.String)
})
const RescheduleHttpCommand = Schema.Union([
  Schema.Struct({
    action: Schema.Literal('begin'),
    capability: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
    expiresAt: Schema.String
  }),
  Schema.Struct({
    action: Schema.Literal('prepare'),
    sessionId: Schema.String,
    capability: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
    replacement: RescheduleReplacementInput
  }),
  Schema.Struct({
    action: Schema.Literal('commit'),
    sessionId: Schema.String,
    capability: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
    idempotencyKey: Schema.String.check(Schema.isMinLength(8))
  })
])

type BookingSessionCookieInput = {
  readonly sessionId: string
  readonly merchantSlug: string
  readonly capability: string
  readonly absoluteExpiresAt: string
  readonly now: string
  readonly secure: boolean
}

const serializeBookingSessionCookie = (
  input: BookingSessionCookieInput,
  path: string
): BookingSessionEffect<string, InvalidBookingSessionCookie> => {
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
      `Path=${path}`,
      `Max-Age=${maxAge}`,
      'HttpOnly',
      input.secure ? 'Secure' : null,
      'SameSite=Lax'
    ]
      .filter((part): part is string => part !== null)
      .join('; ')
  )
}

export const bookingSessionCookie = (
  input: BookingSessionCookieInput
): BookingSessionEffect<string, InvalidBookingSessionCookie> =>
  serializeBookingSessionCookie(input, `/${input.merchantSlug}/booking`)

const bookingLandingSessionCookie = (
  input: BookingSessionCookieInput
): BookingSessionEffect<string, InvalidBookingSessionCookie> =>
  serializeBookingSessionCookie(input, `/booking/${input.merchantSlug}`)

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
    readonly routeLocator: string | null
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
  readonly authorizeRoute?: (input: {
    readonly merchantSlug: string
    readonly routeId: string
    readonly candidates: readonly PresentedBookingSessionCapability[]
    readonly now: string
    readonly allowConfirmedReplay?: boolean
  }) => BookingSessionEffect<
    BookingSession,
    BookingSessionNotFound | BookingSessionGone | CapabilityUnavailable
  >
  readonly captureContext?: (
    session: BookingSession,
    context: {
      readonly locale: BookingLocale | null
      readonly embedding: BookingEmbedding
      readonly acquisition: Readonly<Record<string, string>>
    }
  ) => BookingSessionEffect<void, CapabilityUnavailable>
  readonly parties?: {
    readonly load: (
      session: BookingSession,
      now?: string
    ) => BookingSessionEffect<
      BookingParty,
      BookingPartyNotFound | CapabilityUnavailable
    >
    readonly add: (
      partyId: string,
      version: number,
      now: string
    ) => BookingSessionEffect<
      BookingParty,
      BookingPartyNotFound | BookingPartyConflict | CapabilityUnavailable
    >
    readonly remove: (
      partyId: string,
      requestId: string,
      version: number,
      now: string
    ) => BookingSessionEffect<
      BookingParty,
      BookingPartyNotFound | BookingPartyConflict | CapabilityUnavailable
    >
    readonly reorder: (
      partyId: string,
      requestIds: readonly string[],
      version: number,
      now: string
    ) => BookingSessionEffect<
      BookingParty,
      BookingPartyNotFound | BookingPartyConflict | CapabilityUnavailable
    >
    readonly update: (
      partyId: string,
      requestId: string,
      material: BookingRequestMaterial,
      version: number,
      now: string
    ) => BookingSessionEffect<
      BookingParty,
      BookingPartyNotFound | BookingPartyConflict | CapabilityUnavailable
    >
    readonly activate: (
      partyId: string,
      requestId: string,
      version: number,
      now: string
    ) => BookingSessionEffect<
      BookingParty,
      BookingPartyNotFound | BookingPartyConflict | CapabilityUnavailable
    >
  }
  readonly selection?: {
    readonly load: (
      session: BookingSession,
      now?: string
    ) => BookingSessionEffect<
      BookingJourney,
      BookingSelectionRejected | BookingPartyConflict | CapabilityUnavailable
    >
    readonly chooseProvider: (
      session: BookingSession,
      preference: ProviderPreference,
      expectedVersion: number,
      providerProof?: string,
      now?: string
    ) => BookingSessionEffect<
      BookingJourney,
      BookingSelectionRejected | BookingPartyConflict | CapabilityUnavailable
    >
    readonly verifyProviderAccess?: (
      session: BookingSession,
      providerId: string,
      passcode: string,
      now: string
    ) => BookingSessionEffect<
      { readonly proof: string; readonly expiresAt: string },
      BookingSelectionRejected | BookingPartyConflict | CapabilityUnavailable
    >
    readonly chooseShop?: (
      session: BookingSession,
      shopId: string,
      expectedVersion: number
    ) => BookingSessionEffect<
      BookingJourney,
      BookingSelectionRejected | BookingPartyConflict | CapabilityUnavailable
    >
    readonly chooseServices: (
      session: BookingSession,
      input: ServiceSelection,
      expectedVersion: number
    ) => BookingSessionEffect<
      BookingJourney,
      BookingSelectionRejected | BookingPartyConflict | CapabilityUnavailable
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
    readonly holdParty?: (
      session: BookingSession,
      input: CoordinatedHoldInput
    ) => BookingSessionEffect<
      readonly TimeSlotHold[],
      BookingSchedulingRejected | CapabilityUnavailable
    >
    readonly release: (
      session: BookingSession
    ) => BookingSessionEffect<void, CapabilityUnavailable>
  }
  readonly checkout?: {
    readonly saveCustomerDetails: (
      session: BookingSession,
      details: CustomerDetails,
      input: { readonly now: string }
    ) => BookingSessionEffect<CheckoutReview, BookingCheckoutFailure>
    readonly review: (
      session: BookingSession,
      input: { readonly now: string }
    ) => BookingSessionEffect<
      CheckoutReview,
      CheckoutUnavailable | CapabilityUnavailable
    >
    readonly prepare: (
      session: BookingSession,
      input: { readonly now: string }
    ) => BookingSessionEffect<CheckoutPreparation, BookingCheckoutFailure>
    readonly acceptQuote: (
      session: BookingSession,
      input: { readonly quoteId: string; readonly now: string }
    ) => BookingSessionEffect<unknown, BookingCheckoutFailure>
    readonly acceptPolicy: (
      session: BookingSession,
      input: { readonly policyId: string; readonly now: string }
    ) => BookingSessionEffect<CheckoutPolicyAcceptance, BookingCheckoutFailure>
    readonly recordMarketingConsent: (
      session: BookingSession,
      input: {
        readonly bookingRequestId: string
        readonly channel: 'email' | 'sms'
        readonly granted: boolean
        readonly now: string
      }
    ) => BookingSessionEffect<MarketingConsent, BookingCheckoutFailure>
    readonly reviewParty: (
      session: BookingSession,
      input: { readonly now: string }
    ) => BookingSessionEffect<PartyCheckoutReview, BookingCheckoutFailure>
  }
  readonly confirmation?: {
    readonly confirm: (
      session: BookingSession,
      input: { readonly now: string; readonly traceId: string }
    ) => BookingSessionEffect<
      BookingConfirmationResult,
      | BookingConfirmationRejected
      | BookingConfirmationProcessing
      | CapabilityUnavailable
    >
    readonly read: (input: {
      readonly routeId: string
      readonly merchantSlug: string
      readonly credential: string
      readonly credentialKind: 'bearer' | 'cookie'
      readonly now: string
    }) => BookingSessionEffect<ConfirmationReadResult, CapabilityUnavailable>
  }
  readonly cancellations?: {
    readonly cancel: (input: {
      readonly merchantSlug: string
      readonly scope:
        | { readonly kind: 'appointment'; readonly appointmentId: string }
        | { readonly kind: 'party'; readonly confirmationRouteId: string }
      readonly idempotencyKey: string
      readonly reason: string
      readonly now: string
    }) => BookingSessionEffect<
      CancellationResult,
      CapabilityUnavailable | { readonly _tag: string; readonly code?: string }
    >
  }
  readonly rescheduling?: {
    readonly execute: (input: {
      readonly merchantSlug: string
      readonly appointmentId: string
      readonly command: typeof RescheduleHttpCommand.Type
      readonly now: string
    }) => BookingSessionEffect<
      unknown,
      CapabilityUnavailable | { readonly _tag: string; readonly code?: string }
    >
  }
  readonly payments?: {
    readonly status: (
      session: BookingSession
    ) => BookingSessionEffect<
      PaymentView | null,
      CapabilityUnavailable | { readonly _tag: string; readonly code?: string }
    >
    readonly methods: (
      session: BookingSession,
      input: {
        readonly now: string
        readonly wallets: {
          readonly applePay: boolean
          readonly googlePay: boolean
          readonly cashAppPay: boolean
        }
      }
    ) => BookingSessionEffect<
      PaymentMethodEligibility & {
        readonly giftCardMinor: number
        readonly externalPaymentMinor: number
      },
      | CapabilityUnavailable
      | BookingCheckoutFailure
      | { readonly _tag: string; readonly code?: string }
    >
    readonly settle: (
      session: BookingSession,
      input: {
        readonly method: OnlinePaymentMethod
        readonly idempotencyKey: string
        readonly paymentMethodReference: string
        readonly now: string
      }
    ) => BookingSessionEffect<
      { readonly view: PaymentView; readonly nextActionUrl: string | null },
      CapabilityUnavailable | { readonly _tag: string; readonly code?: string }
    >
  }
  readonly giftCards?: {
    readonly reserve: (
      session: BookingSession,
      input: {
        readonly giftCardCode: string
        readonly amountMinor: number
        readonly idempotencyKey: string
        readonly now: string
      }
    ) => BookingSessionEffect<
      GiftCardReservation,
      CapabilityUnavailable | { readonly _tag: string; readonly code?: string }
    >
    readonly release: (
      session: BookingSession,
      input: {
        readonly idempotencyKey: string
        readonly now: string
      }
    ) => BookingSessionEffect<
      number,
      CapabilityUnavailable | { readonly _tag: string; readonly code?: string }
    >
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

const GiftCardReservationInput = Schema.Struct({
  giftCardCode: Schema.String.check(Schema.isMinLength(1)),
  amountMinor: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  idempotencyKey: Schema.String.check(Schema.isMinLength(8))
})

const expired = (
  merchantSlug: string,
  locale: BookingLocale = 'en',
  embedding: BookingEmbedding = 'standalone'
): Response => {
  const title = translateBookingMessage(locale, 'status.session_expired')
  const copy = translateBookingMessage(locale, 'recovery.session_expired_copy')
  const restart = translateBookingMessage(locale, 'action.start_again')
  return new Response(
    `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>${title}</title></head><body data-embedding="${embedding}"><main><h1>${title}</h1><p>${copy}</p><a href="/${encodeURIComponent(merchantSlug)}/booking">${restart}</a></main></body></html>`,
    {
      status: 410,
      headers: {
        'cache-control': 'private, no-store',
        'content-type': 'text/html; charset=utf-8',
        'referrer-policy': 'no-referrer'
      }
    }
  )
}

const unmatchedRoute = (
  merchantSlug: string,
  locale: BookingLocale,
  embedding: BookingEmbedding
): Response => {
  const title = translateBookingMessage(locale, 'recovery.booking_not_found_title')
  const copy = translateBookingMessage(locale, 'recovery.booking_not_found_copy')
  const restart = translateBookingMessage(locale, 'action.start_again')
  return withPrivateHeaders(
    new Response(
      `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head><body data-embedding="${embedding}"><main><h1>${title}</h1><p>${copy}</p><a href="/${encodeURIComponent(merchantSlug)}/booking">${restart}</a></main></body></html>`,
      {
        status: 404,
        headers: {
          'content-language': locale,
          'content-type': 'text/html; charset=utf-8',
          'x-booking-embedding': embedding
        }
      }
    )
  )
}

const mapSessionFailure = (
  error: BookingSessionHttpFailure,
  merchantSlug: string
): Response => {
  if (error instanceof BookingSessionGone) {
    return expired(
      merchantSlug,
      error.locale ?? 'en',
      error.embeddingProfile ?? 'standalone'
    )
  }
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
  if (
    error instanceof CheckoutCommandRejected ||
    error instanceof CheckoutReviewUnavailable
  ) {
    return withPrivateHeaders(Response.json({ kind: error.reason }, { status: 409 }))
  }
  if (error instanceof QuoteUnconfirmable) {
    return withPrivateHeaders(
      Response.json({ kind: `quote_${error.reason}` }, { status: 409 })
    )
  }
  if (error instanceof PricingQuoteNotFound || error instanceof InvalidQuoteMaterial) {
    return withPrivateHeaders(Response.json({ kind: 'quote_stale' }, { status: 409 }))
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

const jsonJourney = (value: BookingJourney): Response =>
  withPrivateHeaders(
    Response.json(value, {
      headers: { 'content-type': 'application/json; charset=utf-8' }
    })
  )

const jsonPrivate = (value: unknown): Response =>
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

const versionFrom = (value: unknown): number | null => {
  if (typeof value !== 'object' || value === null) return null
  const version = (value as Record<string, unknown>).version
  return typeof version === 'number' && Number.isSafeInteger(version) && version > 0
    ? version
    : null
}

const bookingRequestMaterialFrom = (value: unknown): BookingRequestMaterial | null => {
  try {
    return Schema.decodeUnknownSync(BookingRequestMaterialSchema)(value)
  } catch {
    return null
  }
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

const localeCountry = {
  en: 'US',
  es: 'ES',
  fr: 'FR',
  ro: 'RO'
} as const

const customerDetailsFrom = (
  value: unknown
):
  | {
      readonly details: {
        readonly name: string
        readonly email: string
        readonly phone: string | null
      }
      readonly issues: null
    }
  | { readonly details: null; readonly issues: readonly CustomerDetailsIssue[] } => {
  if (typeof value !== 'object' || value === null)
    return { details: null, issues: [{ field: 'name', code: 'name_required' }] }
  const input = value as Record<string, unknown>
  if (
    typeof input.name !== 'string' ||
    typeof input.email !== 'string' ||
    (input.phone !== null &&
      input.phone !== undefined &&
      typeof input.phone !== 'string')
  ) {
    const issues: CustomerDetailsIssue[] = []
    if (typeof input.name !== 'string')
      issues.push({ field: 'name', code: 'name_required' })
    if (typeof input.email !== 'string')
      issues.push({ field: 'email', code: 'email_invalid' })
    if (
      input.phone !== null &&
      input.phone !== undefined &&
      typeof input.phone !== 'string'
    )
      issues.push({ field: 'phone', code: 'phone_invalid' })
    return { details: null, issues }
  }
  return {
    details: {
      name: input.name,
      email: input.email,
      phone: typeof input.phone === 'string' ? input.phone : null
    },
    issues: null
  }
}

const sessionContextFrom = (
  value: unknown
): { readonly locale: BookingLocale; readonly embedding: BookingEmbedding } | null => {
  if (typeof value !== 'object' || value === null) return null
  const input = value as Record<string, unknown>
  const locale =
    typeof input.locale === 'string' ? parseBookingLocale(input.locale) : null
  const embedding = input.embedding
  if (
    !locale ||
    (embedding !== 'standalone' && embedding !== 'widget' && embedding !== 'google')
  ) {
    return null
  }
  return { locale, embedding }
}

export const handleBookingSessionRequest = (
  request: Request,
  dependencies: BookingSessionHttpDependencies
): BookingSessionEffect<Response> =>
  Effect.gen(function* () {
    const url = new URL(request.url)
    const segments = safeSegments(url.pathname)
    const bookingFirstLanding =
      segments?.length === 2 && segments[0]?.toLowerCase() === 'booking'
    if (
      !segments ||
      (!bookingFirstLanding && segments[1]?.toLowerCase() !== 'booking')
    ) {
      return yield* dependencies.fallback(request)
    }
    const merchantSlug = bookingFirstLanding ? segments[1] : segments[0]
    if (!merchantSlug) return hiddenNotFound()
    const now = dependencies.now?.() ?? new Date().toISOString()
    const clientKey = request.headers.get('cf-connecting-ip') ?? `path:${url.pathname}`

    const rescheduleMatch =
      segments.length === 7 &&
      segments[2] === 'confirmations' &&
      segments[4] === 'appointments' &&
      segments[6] === 'reschedule'
        ? { routeId: segments[3]!, appointmentId: segments[5]! }
        : null
    if (rescheduleMatch) {
      if (
        request.method !== 'POST' ||
        !CONFIRMATION_ID.test(rescheduleMatch.routeId) ||
        !dependencies.confirmation ||
        !dependencies.rescheduling
      )
        return withPrivateHeaders(hiddenNotFound())
      const invalidMutation = validatePrivateMutationRequest(
        request,
        dependencies.publicSiteOrigin
      )
      if (invalidMutation) return withPrivateHeaders(invalidMutation)
      if (!(yield* dependencies.takeWrite(`reschedule:${clientKey}`)))
        return withPrivateHeaders(tooManyRequests())
      const cookieName = `confirmation_${rescheduleMatch.routeId}`
      const credential = request.headers
        .get('cookie')
        ?.split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${cookieName}=`))
        ?.slice(cookieName.length + 1)
      if (!credential || !CONFIRMATION_TOKEN.test(credential))
        return withPrivateHeaders(hiddenNotFound())
      const access = yield* Effect.result(
        dependencies.confirmation.read({
          routeId: rescheduleMatch.routeId,
          merchantSlug,
          credential,
          credentialKind: 'cookie',
          now
        })
      )
      if (
        access._tag === 'Failure' ||
        access.success.kind !== 'found' ||
        !access.success.confirmation.appointments.some(
          (appointment) => appointment.id === rescheduleMatch.appointmentId
        )
      )
        return withPrivateHeaders(hiddenNotFound())
      const decoded = yield* Effect.result(
        Schema.decodeUnknownEffect(RescheduleHttpCommand)(yield* readJson(request))
      )
      if (decoded._tag === 'Failure') return withPrivateHeaders(hiddenNotFound())
      const result = yield* Effect.result(
        dependencies.rescheduling.execute({
          merchantSlug,
          appointmentId: rescheduleMatch.appointmentId,
          command: decoded.success,
          now
        })
      )
      if (result._tag === 'Failure') {
        const code = 'code' in result.failure ? result.failure.code : undefined
        return code === 'appointment_not_found'
          ? withPrivateHeaders(hiddenNotFound())
          : withPrivateHeaders(
              Response.json({ kind: code ?? 'reschedule_failed' }, { status: 409 })
            )
      }
      if (
        decoded.success.action === 'begin' &&
        typeof result.success === 'object' &&
        result.success !== null &&
        'bookingSessionId' in result.success &&
        'expiresAt' in result.success
      ) {
        const response = jsonPrivate(result.success)
        response.headers.append(
          'set-cookie',
          `${COOKIE_PREFIX}${String(result.success.bookingSessionId)}=${decoded.success.capability}; Path=/${merchantSlug}/booking; HttpOnly; ${url.protocol === 'https:' ? 'Secure; ' : ''}SameSite=Lax`
        )
        return response
      }
      return jsonPrivate(result.success)
    }

    const cancellationMatch =
      segments.length === 7 &&
      segments[2] === 'confirmations' &&
      segments[4] === 'appointments' &&
      segments[6] === 'cancel'
        ? {
            routeId: segments[3]!,
            scope: {
              kind: 'appointment' as const,
              appointmentId: segments[5]!
            }
          }
        : segments.length === 5 &&
            segments[2] === 'confirmations' &&
            segments[4] === 'cancel'
          ? {
              routeId: segments[3]!,
              scope: {
                kind: 'party' as const,
                confirmationRouteId: segments[3]!
              }
            }
          : null
    if (cancellationMatch) {
      if (
        request.method !== 'POST' ||
        !CONFIRMATION_ID.test(cancellationMatch.routeId) ||
        !dependencies.confirmation ||
        !dependencies.cancellations
      )
        return withPrivateHeaders(hiddenNotFound())
      const invalidMutation = validatePrivateMutationRequest(
        request,
        dependencies.publicSiteOrigin
      )
      if (invalidMutation) return withPrivateHeaders(invalidMutation)
      if (!(yield* dependencies.takeWrite(`cancellation:${clientKey}`)))
        return withPrivateHeaders(tooManyRequests())
      const cookieName = `confirmation_${cancellationMatch.routeId}`
      const credential = request.headers
        .get('cookie')
        ?.split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${cookieName}=`))
        ?.slice(cookieName.length + 1)
      if (!credential || !CONFIRMATION_TOKEN.test(credential))
        return withPrivateHeaders(hiddenNotFound())
      const access = yield* Effect.result(
        dependencies.confirmation.read({
          routeId: cancellationMatch.routeId,
          merchantSlug,
          credential,
          credentialKind: 'cookie',
          now
        })
      )
      if (access._tag === 'Failure' || access.success.kind !== 'found')
        return withPrivateHeaders(hiddenNotFound())
      if (
        cancellationMatch.scope.kind === 'appointment' &&
        !access.success.confirmation.appointments.some(
          (appointment) => appointment.id === cancellationMatch.scope.appointmentId
        )
      )
        return withPrivateHeaders(hiddenNotFound())
      const body = yield* readJson(request)
      const decoded = yield* Effect.result(
        Schema.decodeUnknownEffect(
          Schema.Struct({
            idempotencyKey: Schema.String.check(Schema.isMinLength(8)),
            reason: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120))
          })
        )(body)
      )
      if (decoded._tag === 'Failure') return withPrivateHeaders(hiddenNotFound())
      const result = yield* Effect.result(
        dependencies.cancellations.cancel({
          merchantSlug,
          scope: cancellationMatch.scope,
          ...decoded.success,
          now
        })
      )
      if (result._tag === 'Failure') {
        const code = 'code' in result.failure ? result.failure.code : undefined
        return code === 'appointment_not_found' || code === 'party_not_found'
          ? withPrivateHeaders(hiddenNotFound())
          : withPrivateHeaders(
              Response.json({ kind: code ?? 'cancellation_failed' }, { status: 409 })
            )
      }
      return jsonPrivate(result.success)
    }

    if (
      segments.length === 5 &&
      segments[2] === 'confirmations' &&
      segments[4] === 'data'
    ) {
      const routeId = segments[3]
      if (
        request.method !== 'GET' ||
        !routeId ||
        !CONFIRMATION_ID.test(routeId) ||
        !dependencies.confirmation
      )
        return withPrivateHeaders(hiddenNotFound())
      if (!(yield* dependencies.takeRead(`confirmation:data:${clientKey}`)))
        return withPrivateHeaders(tooManyRequests())
      const cookieName = `confirmation_${routeId}`
      const credential = request.headers
        .get('cookie')
        ?.split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${cookieName}=`))
        ?.slice(cookieName.length + 1)
      if (!credential || !CONFIRMATION_TOKEN.test(credential))
        return withPrivateHeaders(hiddenNotFound())
      const result = yield* Effect.result(
        dependencies.confirmation.read({
          routeId,
          merchantSlug,
          credential,
          credentialKind: 'cookie',
          now
        })
      )
      if (result._tag === 'Failure') return withPrivateHeaders(unavailable())
      if (result.success.kind === 'not_found')
        return withPrivateHeaders(hiddenNotFound())
      if (result.success.kind === 'expired')
        return withPrivateHeaders(
          Response.json(
            {
              kind: 'expired',
              title: translateBookingMessage(
                result.success.locale,
                'confirmation.expired_title'
              ),
              copy: translateBookingMessage(
                result.success.locale,
                'confirmation.expired_copy'
              )
            },
            { status: 410 }
          )
        )
      return jsonPrivate(result.success.confirmation)
    }

    if (segments.length === 4 && segments[2] === 'confirmations') {
      const routeId = segments[3]
      if (
        request.method !== 'GET' ||
        !routeId ||
        !CONFIRMATION_ID.test(routeId) ||
        !dependencies.confirmation
      )
        return withPrivateHeaders(hiddenNotFound())
      const cookieName = `confirmation_${routeId}`
      const cookieToken = request.headers
        .get('cookie')
        ?.split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${cookieName}=`))
        ?.slice(cookieName.length + 1)
      const queryToken = url.searchParams.get('token')
      if (
        !(yield* dependencies.takeRead(
          `confirmation:${queryToken ? 'exchange' : 'display'}:${clientKey}`
        ))
      )
        return withPrivateHeaders(tooManyRequests())
      const credential = queryToken ?? cookieToken
      if (!credential || !CONFIRMATION_TOKEN.test(credential))
        return withPrivateHeaders(hiddenNotFound())
      const result = yield* Effect.result(
        dependencies.confirmation.read({
          routeId,
          merchantSlug,
          credential,
          credentialKind: queryToken ? 'bearer' : 'cookie',
          now
        })
      )
      if (result._tag === 'Failure') return withPrivateHeaders(unavailable())
      if (result.success.kind === 'not_found')
        return withPrivateHeaders(hiddenNotFound())
      if (result.success.kind === 'expired')
        return withPrivateHeaders(
          new Response(
            `<!doctype html><html lang="${result.success.locale}"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>${escapeHtml(translateBookingMessage(result.success.locale, 'confirmation.expired_title'))}</title></head><body><main><h1>${escapeHtml(translateBookingMessage(result.success.locale, 'confirmation.expired_title'))}</h1><p>${escapeHtml(translateBookingMessage(result.success.locale, 'confirmation.expired_copy'))}</p></main></body></html>`,
            { status: 410, headers: { 'content-type': 'text/html; charset=utf-8' } }
          )
        )
      const canonicalPath = `/${encodeURIComponent(merchantSlug)}/booking/confirmations/${encodeURIComponent(routeId)}`
      if (queryToken) {
        const headers = new Headers({ location: canonicalPath })
        headers.append(
          'set-cookie',
          [
            `${cookieName}=${result.success.cookieCredential}`,
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
      return withPrivateHeaders(yield* dependencies.fallback(request))
    }

    const canonical = canonicalizeBookingRequest(url)
    const canonicalRoute = canonical
      ? matchCanonicalBookingRoute(new URL(canonical.canonicalUrl, url).pathname)
      : null
    if (canonical && canonicalRoute && !canonicalRoute.transactional) {
      if (request.method !== 'GET') return hiddenNotFound()
      if (!(yield* dependencies.takeRead(`entry:${clientKey}`))) {
        return tooManyRequests()
      }
      const candidates = readBookingSessionCapabilities(request.headers.get('cookie'))
      const entryResult = yield* Effect.result(
        dependencies.enter({
          merchantSlug: canonicalRoute.merchantSlug,
          routeLocator: canonical.bookingLocator,
          candidates,
          now
        })
      )
      if (entryResult._tag === 'Failure') {
        return mapSessionFailure(entryResult.failure, canonicalRoute.merchantSlug)
      }
      const entry = entryResult.success
      const resolvedLocale = canonical.locale ?? entry.session.locale ?? 'en'
      const requestedEmbedding = url.searchParams.get('embed')
      const resolvedEmbedding =
        requestedEmbedding === 'widget' || requestedEmbedding === 'google'
          ? canonical.embedding
          : (entry.session.embeddingProfile ?? 'standalone')
      if (dependencies.captureContext) {
        const captured = yield* Effect.result(
          dependencies.captureContext(entry.session, {
            locale: resolvedLocale,
            embedding: resolvedEmbedding,
            acquisition: canonical.acquisition
          })
        )
        if (captured._tag === 'Failure')
          return mapSessionFailure(captured.failure, canonicalRoute.merchantSlug)
      }

      const continuation = new URLSearchParams({ booking: entry.routeId })
      if (resolvedLocale !== 'en' || canonical.locale) {
        continuation.set('locale', resolvedLocale)
      }
      if (resolvedEmbedding !== 'standalone') {
        continuation.set('embed', resolvedEmbedding)
      }
      const location = `${canonicalRoute.pathname}?${continuation.toString()}`
      const hasAcquisition = Object.keys(canonical.acquisition).length > 0
      const settled =
        entry.kind === 'resumed' &&
        canonical.bookingLocator === entry.routeId &&
        !canonical.changed &&
        !hasAcquisition &&
        `${url.pathname}${url.search}` === location
      if (settled) return yield* dependencies.fallback(request)

      const headers = new Headers({
        location,
        'cache-control': 'private, no-store',
        'referrer-policy': 'no-referrer',
        'content-language': resolvedLocale,
        'x-booking-embedding': resolvedEmbedding
      })
      if (entry.kind === 'created') {
        const cookieInput = {
          sessionId: entry.session.id,
          merchantSlug: canonicalRoute.merchantSlug,
          capability: entry.capability,
          absoluteExpiresAt: entry.session.absoluteExpiresAt,
          now,
          secure: url.protocol === 'https:'
        }
        const cookieResult = yield* Effect.result(bookingSessionCookie(cookieInput))
        if (cookieResult._tag === 'Failure') {
          return mapSessionFailure(cookieResult.failure, canonicalRoute.merchantSlug)
        }
        headers.append('set-cookie', cookieResult.success)
        if (canonicalRoute.pathname.startsWith('/booking/')) {
          const aliasCookieResult = yield* Effect.result(
            bookingLandingSessionCookie(cookieInput)
          )
          if (aliasCookieResult._tag === 'Failure') {
            return mapSessionFailure(
              aliasCookieResult.failure,
              canonicalRoute.merchantSlug
            )
          }
          headers.append('set-cookie', aliasCookieResult.success)
        }
      }
      return new Response(null, { status: canonical.changed ? 307 : 303, headers })
    }

    if (
      segments.length >= 2 &&
      segments[1]?.toLowerCase() === 'booking' &&
      segments[2]?.toLowerCase() !== 'session'
    ) {
      const locale = parseBookingLocale(url.searchParams.get('locale')) ?? 'en'
      const embed = url.searchParams.get('embed')
      const embedding: BookingEmbedding =
        embed === 'widget' || embed === 'google' ? embed : 'standalone'
      return unmatchedRoute(merchantSlug, locale, embedding)
    }

    if (segments.length < 4 || segments[2] !== 'session') {
      return yield* dependencies.fallback(request)
    }
    const sessionLocator = segments[3]
    if (!sessionLocator || !SESSION_ID.test(sessionLocator)) return hiddenNotFound()
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
    const endpoint = segments.length === 5 ? segments[4] : null
    const candidates = readBookingSessionCapabilities(request.headers.get('cookie'))
    const publicRoute = sessionLocator.startsWith('brt_')
    const presented = candidates.find(
      (candidate) => candidate.sessionId === sessionLocator
    )
    if ((!publicRoute && !presented) || (publicRoute && !dependencies.authorizeRoute)) {
      return hiddenNotFound()
    }
    const authorization = yield* Effect.result(
      publicRoute
        ? dependencies.authorizeRoute!({
            merchantSlug,
            routeId: sessionLocator,
            candidates,
            now,
            allowConfirmedReplay: endpoint === 'confirm'
          })
        : dependencies.authorize({
            merchantSlug,
            sessionId: sessionLocator,
            capability: presented!.capability,
            now,
            allowConfirmedReplay: endpoint === 'confirm'
          })
    )
    if (authorization._tag === 'Failure') {
      return mapSessionFailure(authorization.failure, merchantSlug)
    }
    const sessionId = authorization.success.id
    if (mutation && !(yield* dependencies.takeWrite(`session:${sessionId}`))) {
      return tooManyRequests()
    }

    if (authorization.success.lifecycle === 'consumed' && endpoint !== 'confirm') {
      return expired(merchantSlug)
    }
    if (endpoint === 'context' && request.method === 'POST') {
      if (!dependencies.captureContext) return unavailable()
      const context = sessionContextFrom(yield* readJson(request))
      if (!context)
        return withPrivateHeaders(new Response('Invalid context', { status: 422 }))
      const result = yield* Effect.result(
        dependencies.captureContext(authorization.success, {
          ...context,
          acquisition: {}
        })
      )
      return result._tag === 'Success'
        ? withPrivateHeaders(new Response(null, { status: 204 }))
        : mapSessionFailure(result.failure, merchantSlug)
    }
    if (endpoint === 'party' && request.method === 'GET') {
      if (!dependencies.parties) return unavailable()
      const result = yield* Effect.result(
        dependencies.parties.load(authorization.success)
      )
      return result._tag === 'Success'
        ? jsonPrivate(result.success)
        : mapSessionFailure(result.failure, merchantSlug)
    }
    if (endpoint?.startsWith('party-') && request.method === 'POST') {
      if (!dependencies.parties) return unavailable()
      const current = yield* Effect.result(
        dependencies.parties.load(authorization.success)
      )
      if (current._tag === 'Failure')
        return mapSessionFailure(current.failure, merchantSlug)
      const body = yield* readJson(request)
      const record =
        typeof body === 'object' && body !== null
          ? (body as Record<string, unknown>)
          : {}
      const version = versionFrom(body)
      const material = bookingRequestMaterialFrom(record.material)
      if (!version) return hiddenNotFound()
      const operation =
        endpoint === 'party-add'
          ? dependencies.parties.add(current.success.id, version, now)
          : endpoint === 'party-remove' && typeof record.requestId === 'string'
            ? dependencies.parties.remove(
                current.success.id,
                record.requestId,
                version,
                now
              )
            : endpoint === 'party-reorder' &&
                Array.isArray(record.requestIds) &&
                record.requestIds.every((id) => typeof id === 'string')
              ? dependencies.parties.reorder(
                  current.success.id,
                  record.requestIds as string[],
                  version,
                  now
                )
              : endpoint === 'party-update' &&
                  typeof record.requestId === 'string' &&
                  material
                ? dependencies.parties.update(
                    current.success.id,
                    record.requestId,
                    material,
                    version,
                    now
                  )
                : endpoint === 'party-activate' && typeof record.requestId === 'string'
                  ? dependencies.parties.activate(
                      current.success.id,
                      record.requestId,
                      version,
                      now
                    )
                  : null
      if (!operation) return hiddenNotFound()
      const result = yield* Effect.result(operation)
      return result._tag === 'Success'
        ? jsonPrivate(result.success)
        : mapSessionFailure(result.failure, merchantSlug)
    }
    if (endpoint === 'selection' && request.method === 'GET') {
      if (!dependencies.selection) return unavailable()
      const result = yield* Effect.result(
        dependencies.selection.load(authorization.success, now)
      )
      return result._tag === 'Success'
        ? jsonJourney(result.success)
        : mapSessionFailure(result.failure, merchantSlug)
    }
    if (endpoint === 'provider' && request.method === 'POST') {
      if (!dependencies.selection) return unavailable()
      const body = yield* readJson(request)
      const preference =
        typeof body === 'object' && body !== null
          ? providerPreferenceFrom((body as Record<string, unknown>).preference)
          : null
      const version = versionFrom(body)
      const providerProof =
        typeof body === 'object' &&
        body !== null &&
        typeof (body as Record<string, unknown>).providerProof === 'string'
          ? String((body as Record<string, unknown>).providerProof)
          : undefined
      if (!preference || !version) return hiddenNotFound()
      const result = yield* Effect.result(
        dependencies.selection.chooseProvider(
          authorization.success,
          preference,
          version,
          providerProof,
          now
        )
      )
      if (result._tag === 'Failure' && result.failure instanceof BookingPartyConflict) {
        const latest = yield* Effect.result(
          dependencies.selection.load(authorization.success, now)
        )
        if (latest._tag === 'Success') {
          return withPrivateHeaders(
            Response.json(
              { kind: 'version_conflict', journey: latest.success },
              { status: 409 }
            )
          )
        }
      }
      return result._tag === 'Success'
        ? jsonJourney(result.success)
        : mapSessionFailure(result.failure, merchantSlug)
    }
    if (endpoint === 'provider-access' && request.method === 'POST') {
      if (!dependencies.selection?.verifyProviderAccess) return unavailable()
      const body = yield* readJson(request)
      if (typeof body !== 'object' || body === null) return hiddenNotFound()
      const record = body as Record<string, unknown>
      if (typeof record.providerId !== 'string' || typeof record.passcode !== 'string')
        return hiddenNotFound()
      const result = yield* Effect.result(
        dependencies.selection.verifyProviderAccess(
          authorization.success,
          record.providerId,
          record.passcode,
          now
        )
      )
      return result._tag === 'Success'
        ? jsonPrivate(result.success)
        : mapSessionFailure(result.failure, merchantSlug)
    }
    if (endpoint === 'shop' && request.method === 'POST') {
      if (!dependencies.selection?.chooseShop) return unavailable()
      const body = yield* readJson(request)
      const shopId =
        typeof body === 'object' &&
        body !== null &&
        typeof (body as Record<string, unknown>).shopId === 'string'
          ? (body as Record<string, string>).shopId
          : null
      const version = versionFrom(body)
      if (!shopId || !version) return hiddenNotFound()
      const result = yield* Effect.result(
        dependencies.selection.chooseShop(authorization.success, shopId, version)
      )
      if (result._tag === 'Failure' && result.failure instanceof BookingPartyConflict) {
        const latest = yield* Effect.result(
          dependencies.selection.load(authorization.success, now)
        )
        if (latest._tag === 'Success') {
          return withPrivateHeaders(
            Response.json(
              { kind: 'version_conflict', journey: latest.success },
              { status: 409 }
            )
          )
        }
      }
      return result._tag === 'Success'
        ? jsonJourney(result.success)
        : mapSessionFailure(result.failure, merchantSlug)
    }
    if (endpoint === 'services' && request.method === 'POST') {
      if (!dependencies.selection) return unavailable()
      const body = yield* readJson(request)
      const input =
        typeof body === 'object' && body !== null
          ? servicesFrom((body as Record<string, unknown>).selection)
          : null
      const version = versionFrom(body)
      if (!input || !version) return hiddenNotFound()
      const result = yield* Effect.result(
        dependencies.selection.chooseServices(authorization.success, input, version)
      )
      if (result._tag === 'Failure' && result.failure instanceof BookingPartyConflict) {
        const latest = yield* Effect.result(
          dependencies.selection.load(authorization.success, now)
        )
        if (latest._tag === 'Success') {
          return withPrivateHeaders(
            Response.json(
              { kind: 'version_conflict', journey: latest.success },
              { status: 409 }
            )
          )
        }
      }
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
    if (endpoint === 'holds' && request.method === 'POST') {
      if (!dependencies.scheduling?.holdParty) return unavailable()
      const decoded = yield* Effect.result(
        Schema.decodeUnknownEffect(CoordinatedHoldInputSchema)(yield* readJson(request))
      )
      if (decoded._tag === 'Failure') return hiddenNotFound()
      const result = yield* Effect.result(
        dependencies.scheduling.holdParty(authorization.success, {
          ...decoded.success,
          now
        })
      )
      return result._tag === 'Success'
        ? jsonPrivate(result.success)
        : mapSessionFailure(result.failure, merchantSlug)
    }
    if (endpoint === 'hold' && request.method === 'DELETE') {
      if (!dependencies.scheduling) return unavailable()
      const result = yield* Effect.result(
        dependencies.scheduling.release(authorization.success)
      )
      if (result._tag === 'Success' && dependencies.giftCards) {
        const giftCardRelease = yield* Effect.result(
          dependencies.giftCards.release(authorization.success, {
            idempotencyKey: `hold-abandon:${authorization.success.id}`,
            now
          })
        )
        if (giftCardRelease._tag === 'Failure') return unavailable()
      }
      return result._tag === 'Success'
        ? withPrivateHeaders(new Response(null, { status: 204 }))
        : mapSessionFailure(result.failure, merchantSlug)
    }
    if (endpoint === 'customer-details' && request.method === 'POST') {
      if (!dependencies.checkout) return unavailable()
      const decoded = customerDetailsFrom(yield* readJson(request))
      if (!decoded.details) {
        return withPrivateHeaders(
          Response.json(
            { kind: 'invalid_customer_details', issues: decoded.issues },
            { status: 422 }
          )
        )
      }
      const normalized = yield* Effect.result(
        normalizeCustomerDetails(
          decoded.details,
          localeCountry[authorization.success.locale ?? 'en']
        )
      )
      if (normalized._tag === 'Failure')
        return withPrivateHeaders(
          Response.json(
            { kind: 'invalid_customer_details', issues: normalized.failure.issues },
            { status: 422 }
          )
        )
      const result = yield* Effect.result(
        dependencies.checkout.saveCustomerDetails(
          authorization.success,
          normalized.success,
          { now }
        )
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
    if (endpoint === 'checkout-prepare' && request.method === 'GET') {
      if (!dependencies.checkout) return unavailable()
      const result = yield* Effect.result(
        dependencies.checkout.prepare(authorization.success, { now })
      )
      return result._tag === 'Success'
        ? jsonPrivate(result.success)
        : mapSessionFailure(result.failure, merchantSlug)
    }
    if (endpoint === 'quote-accept' && request.method === 'POST') {
      if (!dependencies.checkout) return unavailable()
      const decoded = yield* Effect.result(
        Schema.decodeUnknownEffect(QuoteAcceptanceInput)(yield* readJson(request))
      )
      if (decoded._tag === 'Failure') return hiddenNotFound()
      const result = yield* Effect.result(
        dependencies.checkout.acceptQuote(authorization.success, {
          ...decoded.success,
          now
        })
      )
      return result._tag === 'Success'
        ? jsonPrivate(result.success)
        : mapSessionFailure(result.failure, merchantSlug)
    }
    if (endpoint === 'policy-accept' && request.method === 'POST') {
      if (!dependencies.checkout) return unavailable()
      const decoded = yield* Effect.result(
        Schema.decodeUnknownEffect(PolicyAcceptanceInput)(yield* readJson(request))
      )
      if (decoded._tag === 'Failure') return hiddenNotFound()
      const result = yield* Effect.result(
        dependencies.checkout.acceptPolicy(authorization.success, {
          ...decoded.success,
          now
        })
      )
      return result._tag === 'Success'
        ? jsonPrivate(result.success)
        : mapSessionFailure(result.failure, merchantSlug)
    }
    if (endpoint === 'marketing-consent' && request.method === 'POST') {
      if (!dependencies.checkout) return unavailable()
      const decoded = yield* Effect.result(
        Schema.decodeUnknownEffect(MarketingConsentInput)(yield* readJson(request))
      )
      if (decoded._tag === 'Failure') return hiddenNotFound()
      const result = yield* Effect.result(
        dependencies.checkout.recordMarketingConsent(authorization.success, {
          ...decoded.success,
          now
        })
      )
      return result._tag === 'Success'
        ? jsonPrivate(result.success)
        : mapSessionFailure(result.failure, merchantSlug)
    }
    if (endpoint === 'checkout-review' && request.method === 'GET') {
      if (!dependencies.checkout) return unavailable()
      const result = yield* Effect.result(
        dependencies.checkout.reviewParty(authorization.success, { now })
      )
      return result._tag === 'Success'
        ? jsonPrivate(result.success)
        : mapSessionFailure(result.failure, merchantSlug)
    }
    if (endpoint === 'gift-card-reserve' && request.method === 'POST') {
      if (!dependencies.giftCards) return unavailable()
      const body = yield* readJson(request)
      const decoded = yield* Effect.result(
        Schema.decodeUnknownEffect(GiftCardReservationInput)(body)
      )
      if (decoded._tag === 'Failure') return hiddenNotFound()
      const result = yield* Effect.result(
        dependencies.giftCards.reserve(authorization.success, {
          ...decoded.success,
          now
        })
      )
      return result._tag === 'Success'
        ? jsonPrivate(result.success)
        : withPrivateHeaders(
            Response.json(
              {
                kind:
                  'code' in result.failure
                    ? result.failure.code
                    : 'gift_card_unavailable'
              },
              { status: 409 }
            )
          )
    }
    if (endpoint === 'gift-card-release' && request.method === 'DELETE') {
      if (!dependencies.giftCards) return unavailable()
      const result = yield* Effect.result(
        dependencies.giftCards.release(authorization.success, {
          idempotencyKey: request.headers.get('idempotency-key') ?? crypto.randomUUID(),
          now
        })
      )
      return result._tag === 'Success' ? jsonPrivate(result.success) : unavailable()
    }
    if (endpoint === 'payment-methods' && request.method === 'GET') {
      if (!dependencies.payments) return unavailable()
      const result = yield* Effect.result(
        dependencies.payments.methods(authorization.success, {
          now,
          wallets: {
            applePay: url.searchParams.get('applePay') === '1',
            googlePay: url.searchParams.get('googlePay') === '1',
            cashAppPay: url.searchParams.get('cashAppPay') === '1'
          }
        })
      )
      return result._tag === 'Success' ? jsonPrivate(result.success) : unavailable()
    }
    if (endpoint === 'payment-status' && request.method === 'GET') {
      if (!dependencies.payments) return unavailable()
      const result = yield* Effect.result(
        dependencies.payments.status(authorization.success)
      )
      return result._tag === 'Success' ? jsonPrivate(result.success) : unavailable()
    }
    if (endpoint === 'payment-settle' && request.method === 'POST') {
      if (!dependencies.payments) return unavailable()
      const body = yield* readJson(request)
      const decoded = yield* Effect.result(
        Schema.decodeUnknownEffect(
          Schema.Struct({
            method: Schema.Literals([
              'card',
              'saved_card',
              'apple_pay',
              'google_pay',
              'cash_app_pay',
              'klarna'
            ]),
            idempotencyKey: Schema.String.check(Schema.isMinLength(8)),
            paymentMethodReference: Schema.String.check(Schema.isMinLength(1))
          })
        )(body)
      )
      if (decoded._tag === 'Failure') return hiddenNotFound()
      const result = yield* Effect.result(
        dependencies.payments.settle(authorization.success, {
          ...decoded.success,
          now
        })
      )
      if (result._tag === 'Failure') {
        const code = 'code' in result.failure ? result.failure.code : undefined
        return withPrivateHeaders(
          Response.json(
            { kind: code ?? 'payment_failed' },
            { status: code === 'payment_processing' ? 202 : 409 }
          )
        )
      }
      return jsonPrivate(result.success)
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
      if (!dependencies.checkout) return unavailable()
      const readiness = yield* Effect.result(
        dependencies.checkout.reviewParty(authorization.success, { now })
      )
      if (readiness._tag === 'Failure')
        return mapSessionFailure(readiness.failure, merchantSlug)
      const traceId = request.headers.get('cf-ray') ?? `trace_${crypto.randomUUID()}`
      const result = yield* Effect.result(
        dependencies.confirmation.confirm(authorization.success, { now, traceId })
      )
      if (
        result._tag === 'Failure' &&
        result.failure instanceof BookingConfirmationProcessing
      )
        return withPrivateHeaders(
          Response.json({ kind: 'processing' }, { status: 202 })
        )
      if (result._tag === 'Failure')
        return mapSessionFailure(result.failure, merchantSlug)
      const confirmed = result.success
      const location = `/${encodeURIComponent(merchantSlug)}/booking/confirmations/${encodeURIComponent(confirmed.access.routeId)}?token=${encodeURIComponent(confirmed.access.token)}`
      const response = Response.json({
        appointment: confirmed.appointment,
        appointments: confirmed.appointments,
        access: {
          routeId: confirmed.access.routeId,
          tokenVersion: confirmed.access.tokenVersion,
          signingKeyId: confirmed.access.signingKeyId,
          expiresAt: confirmed.access.expiresAt
        },
        accesses: confirmed.accesses.map(({ token: _token, ...access }) => access),
        outboxId: confirmed.outboxId,
        outboxIds: confirmed.outboxIds,
        replayed: confirmed.replayed,
        location
      })
      return withPrivateHeaders(response)
    }
    return withPrivateHeaders(yield* dependencies.fallback(request))
  })
