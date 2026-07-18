import { createFileRoute, useLocation } from '@tanstack/react-router'
import { CanonicalBookingShell } from '../components/canonical-booking-shell.tsx'
import { BookingConfirmationRouteFlow } from '../components/booking-confirmation-flow.tsx'
import { GiftCardRouteFlow } from '../components/gift-card-route-flow.tsx'
import { WalkInRouteFlow } from '../components/walk-in-route-flow.tsx'
import { WaitingListRouteFlow } from '../components/waiting-list-route-flow.tsx'
import {
  canonicalizeBookingRequest,
  matchCanonicalBookingRoute
} from '../lib/booking-route-contract.ts'

export const Route = createFileRoute('/$merchantSlug/booking/$')({
  component: CanonicalNestedBookingRoute
})

function CanonicalNestedBookingRoute() {
  const location = useLocation()
  const route = canonicalizeBookingRequest(
    new URL(`${location.pathname}${location.searchStr}`, 'https://booking.local')
  )
  const { merchantSlug } = Route.useParams()
  const matched = matchCanonicalBookingRoute(location.pathname)
  if (matched?.kind === 'confirmation')
    return (
      <BookingConfirmationRouteFlow
        merchantSlug={merchantSlug}
        routeId={decodeURIComponent(location.pathname.split('/').at(-1)!)}
        embedding={route?.embedding ?? 'standalone'}
      />
    )
  if (/\/booking\/waiting-list$/.test(location.pathname))
    return (
      <WaitingListRouteFlow
        pathname={location.pathname}
        application
        locale={route?.locale ?? 'en'}
        embedding={route?.embedding ?? 'standalone'}
      />
    )
  if (/\/booking\/waiting-list\/[^/]+$/.test(location.pathname))
    return (
      <WaitingListRouteFlow
        pathname={location.pathname}
        application
        applicationStatus
        locale={route?.locale ?? 'en'}
        embedding={route?.embedding ?? 'standalone'}
      />
    )
  if (/\/booking\/waiting-list\/[^/]+\/offers\/[^/]+$/.test(location.pathname))
    return (
      <WaitingListRouteFlow
        pathname={location.pathname}
        locale={route?.locale ?? 'en'}
        embedding={route?.embedding ?? 'standalone'}
      />
    )
  if (matched?.kind === 'gift-card-purchase' || matched?.kind === 'gift-card-receipt')
    return (
      <GiftCardRouteFlow
        pathname={location.pathname}
        kind={matched.kind === 'gift-card-purchase' ? 'purchase' : 'receipt'}
        locale={route?.locale ?? 'en'}
        embedding={route?.embedding ?? 'standalone'}
      />
    )
  if (
    matched?.kind === 'walk-in-landing' ||
    matched?.kind === 'walk-in-acknowledgment' ||
    matched?.kind === 'walk-in-service'
  )
    return (
      <WalkInRouteFlow
        pathname={
          matched.kind === 'walk-in-service'
            ? `/${matched.merchantSlug}/booking/${matched.shopSlug}/walk-ins`
            : location.pathname
        }
        locale={route?.locale ?? 'en'}
        acknowledgment={matched.kind === 'walk-in-acknowledgment'}
        initialServiceId={
          matched.kind === 'walk-in-service' ? matched.serviceSlug : undefined
        }
        embedding={route?.embedding ?? 'standalone'}
      />
    )
  if (!route?.bookingLocator) return null
  return (
    <CanonicalBookingShell
      merchantSlug={merchantSlug}
      sessionId={route.bookingLocator}
      locale={route.locale ?? 'en'}
      embedding={route.embedding}
      {...(matched ? { initialRouteKind: matched.kind } : {})}
    />
  )
}
