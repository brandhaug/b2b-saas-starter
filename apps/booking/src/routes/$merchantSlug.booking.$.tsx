import { createFileRoute, useLocation } from '@tanstack/react-router'
import { CanonicalBookingShell } from '../components/canonical-booking-shell.tsx'
import { GiftCardRouteFlow } from '../components/gift-card-route-flow.tsx'
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
  if (matched?.kind === 'gift-card-purchase' || matched?.kind === 'gift-card-receipt')
    return (
      <GiftCardRouteFlow
        pathname={location.pathname}
        kind={matched.kind === 'gift-card-purchase' ? 'purchase' : 'receipt'}
        locale={route?.locale ?? 'en'}
      />
    )
  if (!route?.bookingLocator) return null
  return (
    <CanonicalBookingShell
      merchantSlug={merchantSlug}
      sessionId={route.bookingLocator}
      locale={route.locale ?? 'en'}
      embedding={route.embedding}
    />
  )
}
