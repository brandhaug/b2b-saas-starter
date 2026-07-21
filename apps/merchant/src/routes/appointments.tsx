import { createFileRoute } from '@tanstack/react-router'
import { MerchantShell } from '@/components/merchant-shell/index.ts'
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
      headerDate={date ?? calendar.date}
      layout="home"
    >
      <MobileAppointmentsScreen calendar={calendar} selectedDate={date} />
    </MerchantShell>
  )
}
