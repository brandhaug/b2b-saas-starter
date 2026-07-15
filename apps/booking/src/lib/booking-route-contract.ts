import {
  parseBookingLocale,
  type BookingLocale
} from '../localization/booking-localization.ts'

export type BookingEmbedding = 'standalone' | 'widget' | 'google'

export type CanonicalBookingRouteKind =
  | 'shop-selection'
  | 'provider-selection'
  | 'service-selection'
  | 'additional-service-selection'
  | 'schedule'
  | 'checkout'
  | 'confirmation'
  | 'appointment-cancellation'
  | 'party-cancellation'
  | 'gift-card-purchase'
  | 'gift-card-receipt'
  | 'waiting-list-offer'
  | 'walk-in-landing'
  | 'walk-in-service'
  | 'walk-in-acknowledgment'
  | 'reschedule'

export type CanonicalBookingRoute = {
  readonly kind: CanonicalBookingRouteKind
  readonly merchantSlug: string
  readonly pathname: string
  readonly transactional: boolean
  readonly shopSlug?: string | undefined
  readonly serviceSlug?: string | undefined
}

export type CanonicalBookingPathInput =
  | { readonly kind: 'shop-selection'; readonly merchantSlug: string }
  | {
      readonly kind: 'provider-selection'
      readonly merchantSlug: string
      readonly shopSlug: string
    }
  | {
      readonly kind: 'service-selection'
      readonly merchantSlug: string
      readonly shopSlug: string
      readonly providerSlug: string
    }
  | {
      readonly kind: 'additional-service-selection' | 'schedule'
      readonly merchantSlug: string
      readonly shopSlug: string
      readonly providerSlug: string
      readonly serviceSlug: string
    }
  | {
      readonly kind: 'checkout'
      readonly merchantSlug: string
      readonly sessionId: string
    }

export function buildCanonicalBookingPath(input: CanonicalBookingPathInput): string {
  const merchant = encodeURIComponent(input.merchantSlug)
  if (input.kind === 'shop-selection') return `/${merchant}/booking`
  if (input.kind === 'checkout')
    return `/${merchant}/booking/session/${encodeURIComponent(input.sessionId)}/checkout`
  const shop = encodeURIComponent(input.shopSlug)
  if (input.kind === 'provider-selection') return `/${merchant}/booking/${shop}`
  const services = `/${merchant}/booking/${shop}/${encodeURIComponent(input.providerSlug)}/services`
  if (input.kind === 'service-selection') return services
  const selected = `${services}/${encodeURIComponent(input.serviceSlug)}`
  return input.kind === 'schedule' ? `${selected}/schedule` : selected
}

const SAFE_SEGMENT = /^[a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?$/
const BOOKING_LOCATOR = /^[A-Za-z0-9_-]{1,128}$/
const ACQUISITION_KEY = /^(?:utm_[a-z0-9_]+|gclid|rwg_token)$/
const hasControlOrSeparator = (value: string) => {
  if (value.includes('/') || value.includes('\\')) return true
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) return true
  }
  return false
}

const route = (
  segments: readonly string[],
  kind: CanonicalBookingRouteKind,
  transactional = false
): CanonicalBookingRoute => ({
  kind,
  merchantSlug: segments[0]!,
  pathname: `/${segments.map(encodeURIComponent).join('/')}`,
  transactional,
  shopSlug: segments[2],
  serviceSlug: kind === 'walk-in-service' ? segments[5] : undefined
})

export function matchCanonicalBookingRoute(
  pathname: string
): CanonicalBookingRoute | null {
  if (pathname !== '/' && pathname.endsWith('/')) return null
  let segments: string[]
  try {
    segments = pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment))
  } catch {
    return null
  }
  if (
    segments.length < 2 ||
    segments[1] !== 'booking' ||
    segments.some(
      (segment) => !SAFE_SEGMENT.test(segment) || hasControlOrSeparator(segment)
    )
  ) {
    return null
  }

  if (segments.length === 2) return route(segments, 'shop-selection')
  if (segments.length === 3) return route(segments, 'provider-selection')
  if (
    segments.length === 5 &&
    segments[2] === 'session' &&
    segments[4] === 'checkout'
  ) {
    return route(segments, 'checkout', true)
  }
  if (segments[2] === 'session') return null
  if (segments.length === 4 && segments[2] === 'confirmations') {
    return route(segments, 'confirmation', true)
  }
  if (
    segments.length === 7 &&
    segments[2] === 'confirmations' &&
    segments[4] === 'appointments' &&
    segments[6] === 'cancel'
  ) {
    return route(segments, 'appointment-cancellation', true)
  }
  if (
    segments.length === 5 &&
    segments[2] === 'confirmations' &&
    segments[4] === 'cancel'
  ) {
    return route(segments, 'party-cancellation', true)
  }
  if (segments.length === 4 && segments[2] === 'gift-card-sales') {
    return route(segments, 'gift-card-receipt', true)
  }
  if (segments.length === 4 && segments[2] === 'waiting-list') {
    return route(segments, 'waiting-list-offer', true)
  }
  if (
    segments.length === 7 &&
    segments[2] === 'confirmations' &&
    segments[4] === 'appointments' &&
    segments[6] === 'reschedule'
  ) {
    return route(segments, 'reschedule', true)
  }
  if (segments.length === 4 && segments[3] === 'walk-ins') {
    return route(segments, 'walk-in-landing')
  }
  if (segments.length === 5 && segments[3] === 'walk-ins') {
    return route(segments, 'walk-in-acknowledgment', true)
  }
  if (segments.length === 5 && segments[4] === 'services') {
    return route(segments, 'service-selection')
  }
  if (segments.length === 5 && segments[4] === 'gift-cards') {
    return route(segments, 'gift-card-purchase')
  }
  if (segments.length === 6 && segments[4] === 'services') {
    return route(segments, 'additional-service-selection')
  }
  if (
    segments.length === 7 &&
    segments[4] === 'services' &&
    segments[6] === 'schedule'
  ) {
    return route(segments, 'schedule')
  }
  if (
    segments.length === 7 &&
    segments[3] === 'any' &&
    segments[4] === 'services' &&
    segments[6] === 'walk-in'
  ) {
    return route(segments, 'walk-in-service')
  }
  return null
}

type CanonicalizedBookingRequest = {
  readonly canonicalUrl: string
  readonly changed: boolean
  readonly bookingLocator: string | null
  readonly locale: BookingLocale | null
  readonly embedding: BookingEmbedding
  readonly acquisition: Readonly<Record<string, string>>
}

const normalizePathname = (pathname: string): string | null => {
  let decoded: string[]
  try {
    decoded = pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment))
  } catch {
    return null
  }
  if (decoded.some(hasControlOrSeparator)) return null
  const normalized = decoded.map((segment) => segment.toLowerCase())
  if (normalized.some((segment) => !SAFE_SEGMENT.test(segment))) return null
  return `/${normalized.map(encodeURIComponent).join('/')}`
}

export function canonicalizeBookingRequest(
  url: URL
): CanonicalizedBookingRequest | null {
  const pathname = normalizePathname(url.pathname)
  if (!pathname || !matchCanonicalBookingRoute(pathname)) return null

  const output = new URLSearchParams()
  const bookingInput = url.searchParams.get('booking')
  const bookingLocator =
    bookingInput && BOOKING_LOCATOR.test(bookingInput) ? bookingInput : null
  if (bookingLocator) output.set('booking', bookingLocator)

  const locale = parseBookingLocale(url.searchParams.get('locale'))
  if (locale) output.set('locale', locale)

  const embedInput = url.searchParams.get('embed')
  const embedding: BookingEmbedding =
    embedInput === 'widget' || embedInput === 'google' ? embedInput : 'standalone'
  if (embedding !== 'standalone') output.set('embed', embedding)

  const acquisition: Record<string, string> = {}
  for (const [key, value] of url.searchParams) {
    if (!ACQUISITION_KEY.test(key) || value.length === 0 || value.length > 256) continue
    acquisition[key] = value
    output.set(key, value)
  }

  const query = output.toString()
  const canonicalUrl = query ? `${pathname}?${query}` : pathname
  return {
    canonicalUrl,
    changed: `${url.pathname}${url.search}` !== canonicalUrl,
    bookingLocator,
    locale,
    embedding,
    acquisition
  }
}
