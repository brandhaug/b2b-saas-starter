import { createFileRoute } from '@tanstack/react-router'
import { ServerBackedBookingFlow } from '../components/server-backed-booking-flow'

export const Route = createFileRoute('/$merchantSlug/booking_/session/$sessionId')({
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
  return <ServerBackedBookingFlow merchantSlug={merchantSlug} sessionId={sessionId} />
}
