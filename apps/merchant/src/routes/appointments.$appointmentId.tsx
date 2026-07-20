import { createFileRoute, notFound } from '@tanstack/react-router'
import {
  MerchantPresentationBoundary,
  MerchantShell
} from '@/components/merchant-shell/index.ts'
import { DesktopAppointmentDetailScreen } from '@/features/appointments/desktop/desktop-appointment-detail-screen.tsx'
import { MobileAppointmentDetailScreen } from '@/features/appointments/mobile/mobile-appointment-detail-screen.tsx'
import { getAppointmentDetail } from '@/lib/server/appointment-operations.ts'
import { requireMerchantSession } from '@/lib/server/merchant-session.ts'

export const Route = createFileRoute('/appointments/$appointmentId')({
  beforeLoad: async ({ location }) => requireMerchantSession(location.href),
  loader: async ({ params }) => {
    const result = await getAppointmentDetail({ data: params })
    if (result.kind === 'not_found') throw notFound()
    return result.appointment
  },
  component: AppointmentDetailPage
})

function AppointmentDetailPage() {
  const appointment = Route.useLoaderData()
  return (
    <MerchantShell
      section={{ kind: 'operations' }}
      title="Appointment detail"
      description="An inspect-only record of the facts accepted when this Appointment was confirmed."
    >
      <MerchantPresentationBoundary
        desktop={<DesktopAppointmentDetailScreen appointment={appointment} />}
        mobile={<MobileAppointmentDetailScreen appointment={appointment} />}
      />
    </MerchantShell>
  )
}
