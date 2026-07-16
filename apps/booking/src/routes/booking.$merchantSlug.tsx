import { createFileRoute } from '@tanstack/react-router'
import { CanonicalBookingShell } from '../components/canonical-booking-shell.tsx'
import { validateBookingLandingSearch } from '../lib/booking-landing-route.ts'
import './booking.$merchantSlug.css'

export const Route = createFileRoute('/booking/$merchantSlug')({
  validateSearch: validateBookingLandingSearch,
  component: BookingFirstLandingRoute
})

function BookingFirstLandingRoute() {
  const { merchantSlug } = Route.useParams()
  const { booking, locale, embed } = Route.useSearch()
  if (!booking) return null
  return (
    <CanonicalBookingShell
      merchantSlug={merchantSlug}
      sessionId={booking}
      locale={locale ?? 'en'}
      embedding={embed ?? 'standalone'}
      initialRouteKind="shop-selection"
    />
  )
}
