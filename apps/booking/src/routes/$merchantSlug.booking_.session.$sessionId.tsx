import { createFileRoute } from '@tanstack/react-router'
import { ServerBackedBookingFlow } from '../components/server-backed-booking-flow'
import { MerchantPwaRegistration } from '../components/merchant-pwa-registration'
import { createMerchantBookingPwaConfig } from '../lib/merchant-pwa'

export const Route = createFileRoute('/$merchantSlug/booking_/session/$sessionId')({
  head: ({ params }) => createMerchantBookingPwaConfig(params.merchantSlug).head,
  component: ProtectedBookingSessionRoute
})

function ProtectedBookingSessionRoute() {
  const { merchantSlug, sessionId } = Route.useParams()
  return <BookingSessionRouteView merchantSlug={merchantSlug} sessionId={sessionId} />
}

export function BookingSessionRouteView({
  merchantSlug,
  sessionId
}: {
  readonly merchantSlug: string
  readonly sessionId: string
}) {
  const pwa = createMerchantBookingPwaConfig(merchantSlug)
  return (
    <>
      <MerchantPwaRegistration scope={pwa.scope} />
      <ServerBackedBookingFlow merchantSlug={merchantSlug} sessionId={sessionId} />
    </>
  )
}
