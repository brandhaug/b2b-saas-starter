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
  formatBookingCurrency,
  formatBookingDate,
  formatBookingTime,
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

const inlineScriptJson = (value: string) =>
  JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')

const confirmationHtml = (
  confirmation: Extract<ConfirmationReadResult, { kind: 'found' }>['confirmation']
) => {
  const snapshot = confirmation.snapshot
  const message = (key: string) =>
    translateBookingMessage(
      confirmation.locale,
      key === 'status.pay_in_person' && snapshot.checkoutPath === 'online_payment'
        ? 'status.online_payment'
        : key
    )
  const title = message('title.appointment_confirmation')
  const status = message(`status.appointment_${confirmation.status}`)
  const isGroup = confirmation.appointments.length > 1
  const isCancelled = confirmation.appointments.some(
    (appointment) => appointment.status === 'cancelled'
  )
  const customerFirstName =
    snapshot.customerDetails.name.trim().split(/\s+/)[0] ??
    snapshot.customerDetails.name
  const copyByLocale = {
    en: {
      heading: isGroup
        ? `${customerFirstName}, your order is confirmed!`
        : `${customerFirstName}, your appointment is confirmed!`,
      confirmationCode: 'Confirmation code',
      addToCalendar: 'Add to calendar',
      total: 'Total',
      payInPerson: 'Pay in person',
      pendingPayment: 'Pending payment',
      cancel: isGroup ? 'Cancel appointments' : 'Cancel appointment',
      reschedule: 'Reschedule',
      cancelTitle: isGroup ? 'Cancel appointments?' : 'Cancel appointment?',
      cancelCopy: isGroup
        ? 'Are you sure you want to cancel every appointment in this order?'
        : 'Are you sure you want to cancel this appointment?',
      keep: 'Keep appointment',
      confirmCancel: 'Yes, cancel',
      close: 'Close'
    },
    es: {
      heading: isGroup
        ? `¡${customerFirstName}, tu pedido está confirmado!`
        : `¡${customerFirstName}, tu cita está confirmada!`,
      confirmationCode: 'Código de confirmación',
      addToCalendar: 'Agregar al calendario',
      total: 'Total',
      payInPerson: 'Pagar en persona',
      pendingPayment: 'Pago pendiente',
      cancel: isGroup ? 'Cancelar citas' : 'Cancelar cita',
      reschedule: 'Reprogramar',
      cancelTitle: isGroup ? '¿Cancelar citas?' : '¿Cancelar cita?',
      cancelCopy: '¿Seguro que quieres cancelar?',
      keep: 'Conservar cita',
      confirmCancel: 'Sí, cancelar',
      close: 'Cerrar'
    },
    fr: {
      heading: isGroup
        ? `${customerFirstName}, votre commande est confirmée !`
        : `${customerFirstName}, votre rendez-vous est confirmé !`,
      confirmationCode: 'Code de confirmation',
      addToCalendar: "Ajouter à l'agenda",
      total: 'Total',
      payInPerson: 'Payer sur place',
      pendingPayment: 'Paiement en attente',
      cancel: isGroup ? 'Annuler les rendez-vous' : 'Annuler le rendez-vous',
      reschedule: 'Reprogrammer',
      cancelTitle: isGroup ? 'Annuler les rendez-vous ?' : 'Annuler le rendez-vous ?',
      cancelCopy: 'Voulez-vous vraiment annuler ?',
      keep: 'Garder le rendez-vous',
      confirmCancel: 'Oui, annuler',
      close: 'Fermer'
    },
    ro: {
      heading: isGroup
        ? `${customerFirstName}, rezervarea ta este confirmată!`
        : `${customerFirstName}, programarea ta este confirmată!`,
      confirmationCode: 'Cod de confirmare',
      addToCalendar: 'Adaugă în calendar',
      total: 'Total',
      payInPerson: 'Plată la locație',
      pendingPayment: 'Plată în așteptare',
      cancel: isGroup ? 'Anulează programările' : 'Anulează programarea',
      reschedule: 'Reprogramează',
      cancelTitle: isGroup ? 'Anulezi programările?' : 'Anulezi programarea?',
      cancelCopy: 'Sigur dorești să anulezi?',
      keep: 'Păstrează programarea',
      confirmCancel: 'Da, anulează',
      close: 'Închide'
    }
  } as const
  const copy = copyByLocale[confirmation.locale]
  const calendarButton = (
    kind: 'apple' | 'google' | 'yahoo',
    label: string,
    startsAt: string,
    endsAt: string
  ) =>
    `<button type="button" data-testid="btn:calendar:${kind}" data-calendar-kind="${kind}" data-calendar-start="${escapeHtml(startsAt)}" data-calendar-end="${escapeHtml(endsAt)}" aria-label="${escapeHtml(label)}"><span aria-hidden="true" class="calendar-logo calendar-logo-${kind}">${kind === 'apple' ? '●' : kind === 'google' ? 'G' : 'Y!'}</span></button>`
  const appointmentCards = confirmation.appointments
    .map((appointment) => {
      const appointmentSnapshot = appointment.snapshot
      const primaryService =
        appointmentSnapshot.services.find((service) => service.role === 'primary') ??
        appointmentSnapshot.services[0]
      const additionalServices = appointmentSnapshot.services.filter(
        (service) => service.role === 'additional'
      )
      const services = additionalServices
        .map(
          (service) =>
            `<div class="service-addon"><span>+ ${escapeHtml(service.name)}</span><span>${formatBookingCurrency(confirmation.locale, service.priceMinor, service.currency)}</span></div>`
        )
        .join('')
      const date = formatBookingDate(
        confirmation.locale,
        appointment.startsAt,
        appointmentSnapshot.merchantTimezone
      )
      const time = formatBookingTime(
        confirmation.locale,
        appointment.startsAt,
        appointmentSnapshot.merchantTimezone
      )
      const confirmationCode = appointment.id
        .replace(/^apt_/, '')
        .slice(-8)
        .toUpperCase()
      return `<section data-testid="container:orderApptGroup" class="order-appointment"><div data-testid="container:groupAppt" class="appointment-card"><div class="provider-avatar">${escapeHtml(
        appointmentSnapshot.assignedProvider.displayName
          .split(/\s+/)
          .map((part) => part[0])
          .join('')
          .slice(0, 2)
          .toUpperCase()
      )}</div><div class="appointment-identity"><strong>${escapeHtml(appointmentSnapshot.assignedProvider.displayName)}</strong><span>${primaryService ? escapeHtml(primaryService.name) : ''}</span><span data-testid="text:customerName">${escapeHtml(appointmentSnapshot.customerDetails.name)}</span></div><strong class="appointment-price">${formatBookingCurrency(confirmation.locale, appointmentSnapshot.totalMinor, appointmentSnapshot.currency)}</strong></div>${services ? `<div class="service-addons">${services}</div>` : ''}<div class="breakdown"><div><span>${escapeHtml(copy.confirmationCode)}</span><strong>${escapeHtml(confirmationCode)}</strong></div><div><span>${escapeHtml(message('label.duration'))}</span><span data-testid="text:duration">${appointmentSnapshot.durationMinutes} min</span></div><div><span>${escapeHtml(message('label.time'))}</span><time datetime="${escapeHtml(appointment.startsAt)}">${escapeHtml(date)} ${escapeHtml(time)}</time></div></div>${appointment.status !== 'cancelled' ? `<div class="calendar"><p>${escapeHtml(copy.addToCalendar)}</p><div>${calendarButton('apple', 'iCalendar', appointment.startsAt, appointment.endsAt)}${calendarButton('google', 'Google Calendar', appointment.startsAt, appointment.endsAt)}${calendarButton('yahoo', 'Yahoo Calendar', appointment.startsAt, appointment.endsAt)}</div></div>` : ''}${!isGroup ? `<hr><div class="order-total"><strong>${escapeHtml(copy.total)}</strong><strong>${formatBookingCurrency(confirmation.locale, appointmentSnapshot.totalMinor, appointmentSnapshot.currency)}</strong></div>` : ''}</section>`
    })
    .join('')
  const groupTotal = confirmation.appointments.reduce(
    (total, appointment) => total + appointment.snapshot.totalMinor,
    0
  )
  const groupSummary = isGroup
    ? `<div class="group-total"><strong>${escapeHtml(copy.total)}</strong><strong>${formatBookingCurrency(confirmation.locale, groupTotal, snapshot.currency)}</strong></div>`
    : ''
  const cancellable = isGroup
    ? confirmation.appointments.every(
        (appointment) => appointment.status === 'scheduled'
      )
    : confirmation.appointments[0]?.status === 'scheduled'
  const cancelPath = isGroup
    ? '/cancel'
    : `/appointments/${encodeURIComponent(confirmation.appointments[0]?.id ?? '')}/cancel`
  const rescheduleAction =
    !isGroup && confirmation.appointments[0]?.status === 'scheduled'
      ? `<button type="button" data-testid="btn:reschedule" class="action-button" data-reschedule-path="/appointments/${encodeURIComponent(confirmation.appointments[0].id)}/reschedule">${escapeHtml(copy.reschedule)}</button>`
      : ''
  const actions =
    cancellable || rescheduleAction
      ? `<section class="appointment-actions">${rescheduleAction}${cancellable ? `<button type="button" data-testid="btn:cancel" class="action-button danger" data-popup-open="cancel">${escapeHtml(copy.cancel)}</button>` : ''}</section>`
      : ''
  const cancelDisclosure = snapshot.cancellationPolicy
    ? `<p class="payment-disclosure">${escapeHtml(snapshot.cancellationPolicy.cancellableUntilMinutesBeforeStart === 60 ? 'Cancel up to 1 hour before the appointment.' : `Cancel up to ${Math.round(snapshot.cancellationPolicy.cancellableUntilMinutesBeforeStart / 60)} hours before the appointment.`)}</p>`
    : ''
  const popup = `<div data-testid="reservation-popup-root" class="popup-layer" aria-hidden="true"><div class="popup-backdrop" data-popup-close></div><section role="dialog" aria-modal="true" aria-labelledby="cancel-popup-title" class="popup-container"><button type="button" class="popup-close" data-popup-close aria-label="${escapeHtml(copy.close)}">×</button><h2 id="cancel-popup-title">${escapeHtml(copy.cancelTitle)}</h2><p>${escapeHtml(copy.cancelCopy)}</p><button type="button" class="popup-action" data-popup-close>${escapeHtml(copy.keep)}</button><button type="button" class="popup-action danger" data-cancel-path="${cancelPath}">${escapeHtml(copy.confirmCancel)}</button><p role="status" aria-live="polite"></p></section></div>`
  const script = `<script>(function(){var root=document.querySelector('[data-testid="reservation-popup-root"]');var scrollable=document.querySelector('[data-testid="container:scrollable"]');var openButton=document.querySelector('[data-popup-open="cancel"]');function openPopup(){if(!root)return;root.classList.add('is-open');root.setAttribute('aria-hidden','false')}function closePopup(){if(!root)return;root.classList.remove('is-open');root.setAttribute('aria-hidden','true');openButton&&openButton.focus({preventScroll:true})}openButton&&openButton.addEventListener('click',openPopup);root&&root.querySelectorAll('[data-popup-close]').forEach(function(button){button.addEventListener('click',closePopup)});document.addEventListener('keydown',function(event){if(event.key==='Escape')closePopup()});scrollable&&scrollable.addEventListener('scroll',function(){document.querySelector('[data-testid="container:title"]')?.classList.toggle('is-scrolled',scrollable.scrollTop>0)},{passive:true});document.querySelectorAll('[data-calendar-kind]').forEach(function(button){button.addEventListener('click',function(){var start=button.dataset.calendarStart;var end=button.dataset.calendarEnd;var title=${inlineScriptJson(confirmation.merchant.publicName)};var compact=function(value){return value.replace(/[-:]/g,'').replace('.000','')};var kind=button.dataset.calendarKind;var url=kind==='google'?'https://calendar.google.com/calendar/render?action=TEMPLATE&text='+encodeURIComponent(title)+'&dates='+compact(start)+'/'+compact(end):kind==='yahoo'?'https://calendar.yahoo.com/?v=60&title='+encodeURIComponent(title)+'&st='+compact(start)+'&et='+compact(end):'data:text/calendar;charset=utf-8,'+encodeURIComponent('BEGIN:VCALENDAR\\nVERSION:2.0\\nBEGIN:VEVENT\\nDTSTART:'+compact(start)+'\\nDTEND:'+compact(end)+'\\nSUMMARY:'+title+'\\nEND:VEVENT\\nEND:VCALENDAR');window.open(url,'_blank','noopener,noreferrer')})});document.querySelectorAll('[data-reschedule-path]').forEach(function(button){button.addEventListener('click',async function(){button.disabled=true;try{var bytes=crypto.getRandomValues(new Uint8Array(32));var capability=Array.from(bytes,function(byte){return byte.toString(16).padStart(2,'0')}).join('');var response=await fetch(location.pathname+button.dataset.reschedulePath,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'begin',capability:capability,expiresAt:new Date(Date.now()+900000).toISOString()})});if(!response.ok)throw new Error();var result=await response.json();var base=location.pathname.split('/booking/confirmations/')[0];location.href=base+'/booking?booking='+encodeURIComponent(result.bookingSessionId)}catch(error){button.disabled=false}})});root&&root.querySelectorAll('[data-cancel-path]').forEach(function(button){button.addEventListener('click',async function(){button.disabled=true;var status=root.querySelector('[role=status]');try{var response=await fetch(location.pathname+button.dataset.cancelPath,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idempotencyKey:'cancel-'+crypto.randomUUID(),reason:'customer_requested'})});if(!response.ok)throw new Error();status.textContent=${inlineScriptJson(message('confirmation.cancelled'))};location.reload()}catch(error){button.disabled=false;status.textContent=${inlineScriptJson(message('confirmation.cancel_failed'))}}})})})()</script>`
  return `<!doctype html><html lang="${confirmation.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)}</title><style>:root{color-scheme:light;font-family:"SF Pro Text",Roboto,Arial,sans-serif}*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#323536;color:#000}button{font:inherit;-webkit-tap-highlight-color:transparent}.booking-confirmation{position:relative;width:100%;max-width:375px;height:100dvh;min-height:568px;margin:0 auto;overflow:hidden;background:#f7f7f7}.confirmation-title{position:absolute;z-index:4;top:0;right:0;left:0;display:flex;min-height:88px;align-items:flex-start;gap:16px;padding:24px 44px 16px 16px;transition:background-color .3s;color:#000}.confirmation-title.is-scrolled{background:rgba(247,247,247,.85);backdrop-filter:blur(4px)}.success-icon{width:42px;height:42px;flex:0 0 42px;margin-top:3px;animation:confirmation-in .3s .3s both}.confirmation-title h1{margin:8px 0 0;font-family:"SF Pro Display",Roboto,Arial,sans-serif;font-size:20px;font-weight:600;line-height:24px;letter-spacing:.38px}.confirmation-status{position:absolute;overflow:hidden;width:1px;height:1px;clip:rect(0 0 0 0)}.confirmation-scrollable{position:absolute;inset:0;overflow-x:hidden;overflow-y:auto;padding:104px 16px 32px;scrollbar-width:none}.confirmation-scrollable::-webkit-scrollbar{display:none}.order-appointment{position:relative;margin-bottom:12px;padding:20px 16px;border-radius:8px;background:#ebebeb}.appointment-card{display:flex;align-items:center;min-width:0}.provider-avatar{display:flex;width:48px;height:48px;flex:0 0 48px;align-items:center;justify-content:center;border-radius:8px;background:#d2d2d4;color:#616163;font-size:15px;font-weight:600}.appointment-identity{display:flex;min-width:0;flex:1;flex-direction:column;gap:3px;padding-left:12px}.appointment-identity strong{overflow:hidden;font-size:15px;line-height:20px;text-overflow:ellipsis;white-space:nowrap}.appointment-identity span{overflow:hidden;color:#616163;font-size:13px;line-height:18px;text-overflow:ellipsis;white-space:nowrap}.appointment-price{align-self:flex-start;padding-left:8px;font-size:15px;line-height:20px}.service-addons{display:grid;gap:16px;margin-top:16px}.service-addon{display:flex;justify-content:space-between;color:#616163;font-size:13px}.breakdown{display:grid;gap:16px;margin-top:23px}.breakdown>div,.order-total,.group-total{display:flex;align-items:center;justify-content:space-between;gap:16px}.breakdown span,.breakdown time{color:#616163;font-size:13px;line-height:18px}.breakdown strong{font-size:13px}.calendar{margin-top:20px}.calendar p{margin:0;color:#616163;font-size:13px}.calendar>div{display:flex;gap:9px;margin-top:12px}.calendar button{display:flex;width:100%;height:40px;align-items:center;justify-content:center;padding:0;border:1px solid #dadadc;border-radius:8px;background:transparent;color:#000;cursor:pointer}.calendar-logo{font-weight:600}.calendar-logo-apple{font-size:18px}.calendar-logo-google{font-size:18px}.calendar-logo-yahoo{font-size:14px}.order-appointment hr,.confirmation-divider{height:1px;margin:20px 0;border:0;background:#dadadc}.order-total,.group-total{font-size:15px}.group-total{margin:24px 0}.shop-marker{display:flex;margin-top:24px}.shop-cover{display:flex;width:76px;height:76px;flex:0 0 76px;align-items:center;justify-content:center;border-radius:8px;background:repeating-linear-gradient(-45deg,#e1e1e1 0,#e1e1e1 4px,#dadadc 5px,#dadadc 6px)}.shop-pin{width:22px;height:22px;border:3px solid #fff;border-radius:50%;background:#0083ff;box-shadow:0 4px 16px rgba(0,0,0,.24)}.shop-copy{display:flex;min-width:0;flex-direction:column;justify-content:center;padding-left:16px}.shop-copy strong{font-size:15px;line-height:20px}.shop-copy span{margin-top:2px;color:#616163;font-size:12px}.payment-info{margin-top:24px}.payment-title{display:flex;align-items:center;gap:16px}.payment-icon{display:grid;width:40px;height:28px;place-items:center;border:1px solid #dadadc;border-radius:4px;font-size:15px}.payment-title strong{font-size:15px}.payment-label{margin-left:auto;padding:5px 8px;border-radius:4px;background:#2caf00;color:#fff;font-size:10px;font-weight:600;text-transform:uppercase}.payment-disclosure{margin:12px 0 0;color:rgba(0,0,0,.5);font-size:11px;line-height:15px}.appointment-actions{margin-top:40px}.action-button,.popup-action{width:100%;height:48px;border:1px solid #dadadc;border-radius:8px;background:transparent;font-size:13px;font-weight:600;cursor:pointer}.action-button+.action-button{margin-top:8px}.danger{color:#ff3b30}.popup-layer{position:absolute;z-index:20;inset:0;pointer-events:none}.popup-backdrop{position:absolute;inset:0;background:#000;opacity:0;transition:opacity .15s}.popup-container{position:absolute;right:0;bottom:0;left:0;max-height:calc(100% - 36px);padding:24px 16px 16px;overflow:auto;border-radius:16px 16px 0 0;background:#f7f7f7;box-shadow:0 12px 32px rgba(0,0,0,.16);transform:translateY(100%);transition:transform .15s}.popup-layer.is-open{pointer-events:auto}.popup-layer.is-open .popup-backdrop{opacity:.25}.popup-layer.is-open .popup-container{transform:translateY(0)}.popup-close{position:absolute;top:10px;right:6px;display:grid;width:44px;height:44px;place-items:center;border:0;background:transparent;color:#616163;font-size:28px;cursor:pointer}.popup-container h2{margin:0;padding-right:40px;font-family:"SF Pro Display",Roboto,Arial,sans-serif;font-size:20px;line-height:24px}.popup-container>p{margin:16px 0 24px;color:#616163;font-size:13px;line-height:18px}.popup-action+.popup-action{margin-top:8px}.popup-action.danger{border-color:#dadadc}.popup-container [role=status]{min-height:18px;margin:12px 0 0;color:#616163}@keyframes confirmation-in{from{opacity:0;transform:scale(0)}to{opacity:1;transform:scale(1)}}@media(max-width:375px){.booking-confirmation{max-width:none}}@media(prefers-reduced-motion:reduce){*,*:before,*:after{scroll-behavior:auto!important;animation-duration:.01ms!important;transition-duration:.01ms!important}}</style></head><body><main class="booking-confirmation"><header data-testid="container:title" class="confirmation-title"><svg class="success-icon" viewBox="0 0 42 42" aria-hidden="true"><circle cx="21" cy="21" r="21" fill="${isCancelled ? '#ff3b30' : '#2caf00'}"/><path d="m12.5 21.5 5.4 5.2 11.6-12" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg><h1 data-testid="text:apptConfirmationTitle">${escapeHtml(copy.heading)}</h1><span class="confirmation-status">${escapeHtml(status)}</span></header><div data-testid="container:scrollable" class="confirmation-scrollable">${appointmentCards}${groupSummary}<section class="shop-marker"><div class="shop-cover"><span class="shop-pin"></span></div><div class="shop-copy"><strong data-testid="text:shopName">${escapeHtml(confirmation.merchant.publicName)}</strong><span>${escapeHtml(message('label.merchant'))}</span></div></section><hr class="confirmation-divider"><section class="payment-info"><div class="payment-title"><span class="payment-icon">▣</span><strong data-testid="text:payInPerson">${escapeHtml(copy.payInPerson)}</strong><span class="payment-label">${escapeHtml(isCancelled ? status : copy.pendingPayment)}</span></div>${cancelDisclosure}</section>${actions}</div>${popup}</main>${script}</body></html>`
}

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
      return withPrivateHeaders(
        new Response(confirmationHtml(result.success.confirmation), {
          headers: { 'content-type': 'text/html; charset=utf-8' }
        })
      )
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
