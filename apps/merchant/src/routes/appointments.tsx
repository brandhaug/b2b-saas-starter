import { createFileRoute } from '@tanstack/react-router'
import {
  MerchantPresentationBoundary,
  MerchantShell
} from '@/components/merchant-shell/index.ts'
import { DesktopAppointmentsScreen } from '@/features/appointments/desktop/desktop-appointments-screen.tsx'
import { MobileAppointmentsScreen } from '@/features/appointments/mobile/mobile-appointments-screen.tsx'
import { decodeAppointmentCalendarSearch } from '@/lib/appointment-calendar-date.ts'
import { getAppointmentCalendar } from '@/lib/server/appointment-operations.ts'
import { requireMerchantSession } from '@/lib/server/merchant-session.ts'

export const Route = createFileRoute('/appointments')({
  validateSearch: decodeAppointmentCalendarSearch,
  loaderDeps: ({ search }) => ({ date: search.date }),
  beforeLoad: async ({ location }) => requireMerchantSession(location.href),
  loader: ({ deps }) => getAppointmentCalendar({ data: deps }),
  component: AppointmentsPage
})

function AppointmentsPage() {
  const calendar = Route.useLoaderData()
  const { date } = Route.useSearch()
  return (
    <MerchantShell
      section={{ kind: 'merchant' }}
      title="Appointments"
      description="Your returning-user home: a Provider-oriented day view of accepted Appointment facts."
      mobileLayout="immersive"
    >
      <MerchantPresentationBoundary
        desktop={<DesktopAppointmentsScreen calendar={calendar} selectedDate={date} />}
        mobile={<MobileAppointmentsScreen calendar={calendar} selectedDate={date} />}
      />
    </MerchantShell>
  )
}
