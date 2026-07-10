import { createFileRoute } from '@tanstack/react-router'
import { BookingFlowPrototype } from '../components/booking-flow-prototype'

export const Route = createFileRoute('/$merchantSlug/booking_/session/$sessionId')({
  component: ProtectedBookingSessionRoute
})

function ProtectedBookingSessionRoute() {
  const { merchantSlug } = Route.useParams()
  return (
    <BookingFlowPrototype
      merchantSlug={merchantSlug}
      scenario="ready"
      onScenarioChange={() => {}}
    />
  )
}
