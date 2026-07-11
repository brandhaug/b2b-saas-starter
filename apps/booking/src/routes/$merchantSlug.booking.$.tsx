import { createFileRoute, useLocation } from '@tanstack/react-router'
import { CanonicalBookingShell } from '../components/canonical-booking-shell.tsx'
import { canonicalizeBookingRequest } from '../lib/booking-route-contract.ts'

export const Route = createFileRoute('/$merchantSlug/booking/$')({
  component: CanonicalNestedBookingRoute
})

function CanonicalNestedBookingRoute() {
  const location = useLocation()
  const route = canonicalizeBookingRequest(
    new URL(`${location.pathname}${location.searchStr}`, 'https://booking.local')
  )
  const { merchantSlug } = Route.useParams()
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
