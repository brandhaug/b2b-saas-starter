import { Outlet, createFileRoute, useLocation } from '@tanstack/react-router'
import { CanonicalBookingShell } from '../components/canonical-booking-shell.tsx'
import { parseBookingLocale } from '../localization/booking-localization.ts'
import type { BookingEmbedding } from '../lib/booking-route-contract.ts'

export const Route = createFileRoute('/$merchantSlug/booking')({
  validateSearch: (search: Record<string, unknown>) => {
    const locale = parseBookingLocale(
      typeof search.locale === 'string' ? search.locale : undefined
    )
    const embed =
      search.embed === 'widget' || search.embed === 'google'
        ? (search.embed as BookingEmbedding)
        : null
    return {
      ...(typeof search.booking === 'string' ? { booking: search.booking } : {}),
      ...(locale ? { locale } : {}),
      ...(embed ? { embed } : {})
    }
  },
  component: CanonicalBookingRoute
})

function CanonicalBookingRoute() {
  const { merchantSlug } = Route.useParams()
  const location = useLocation()
  const { booking, locale, embed } = Route.useSearch()
  if (location.pathname !== `/${encodeURIComponent(merchantSlug)}/booking`)
    return <Outlet />
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
