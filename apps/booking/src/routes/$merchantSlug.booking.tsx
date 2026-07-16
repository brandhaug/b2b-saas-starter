import { Outlet, createFileRoute, useLocation } from '@tanstack/react-router'
import { CanonicalBookingShell } from '../components/canonical-booking-shell.tsx'
import { validateBookingLandingSearch } from '../lib/booking-landing-route.ts'
import { createMerchantBookingPwaConfig } from '../lib/merchant-pwa.ts'
import { MerchantPwaRegistration } from '../components/merchant-pwa-registration.tsx'

export const Route = createFileRoute('/$merchantSlug/booking')({
  head: ({ params }) => createMerchantBookingPwaConfig(params.merchantSlug).head,
  validateSearch: validateBookingLandingSearch,
  component: CanonicalBookingRoute
})

function CanonicalBookingRoute() {
  const { merchantSlug } = Route.useParams()
  const pwa = createMerchantBookingPwaConfig(merchantSlug)
  const location = useLocation()
  const { booking, locale, embed } = Route.useSearch()
  let content = null
  if (location.pathname !== `/${encodeURIComponent(merchantSlug)}/booking`) {
    content = <Outlet />
  } else if (booking) {
    content = (
      <CanonicalBookingShell
        merchantSlug={merchantSlug}
        sessionId={booking}
        locale={locale ?? 'en'}
        embedding={embed ?? 'standalone'}
        initialRouteKind="shop-selection"
      />
    )
  }

  return (
    <>
      <MerchantPwaRegistration scope={pwa.scope} />
      {content}
    </>
  )
}
