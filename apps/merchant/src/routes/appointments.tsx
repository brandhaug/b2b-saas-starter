import { createFileRoute } from '@tanstack/react-router'
import {
  MerchantPresentationBoundary,
  MerchantShell
} from '@/components/merchant-shell/index.ts'
import { DesktopAppointmentsScreen } from '@/features/appointments/desktop/desktop-appointments-screen.tsx'
import { MobileAppointmentsScreen } from '@/features/appointments/mobile/mobile-appointments-screen.tsx'
import { getAppointmentCalendar } from '@/lib/server/appointment-operations.ts'
import { requireMerchantSession } from '@/lib/server/merchant-session.ts'

export const Route = createFileRoute('/appointments')({
  beforeLoad: async ({ location }) => requireMerchantSession(location.href),
  validateSearch: (search: Record<string, unknown>) => ({
    date: typeof search.date === 'string' ? search.date : undefined
  }),
  loaderDeps: ({ search }) => ({ date: search.date }),
  loader: ({ deps }) => getAppointmentCalendar({ data: deps }),
  component: AppointmentsPage
})

function AppointmentsPage() {
  const calendar = Route.useLoaderData()
  const { date } = Route.useSearch()
  return (
    <MerchantShell
      section={{ kind: 'operations' }}
      title="Appointments"
      description="Your returning-user home: a Provider-oriented day view of accepted Appointment facts."
    >
      <MerchantPresentationBoundary
        desktop={<DesktopAppointmentsScreen calendar={calendar} selectedDate={date} />}
        mobile={<MobileAppointmentsScreen calendar={calendar} selectedDate={date} />}
      />
    </MerchantShell>
  )
}
