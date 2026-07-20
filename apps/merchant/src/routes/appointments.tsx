import { createFileRoute } from '@tanstack/react-router'
import { useMemo } from 'react'
import {
  MerchantPresentationBoundary,
  MerchantShell,
  useRememberDesktopWorkspace
} from '@/components/merchant-shell/index.ts'
import { DesktopAppointmentsScreen } from '@/features/appointments/desktop/desktop-appointments-screen.tsx'
import { MobileAppointmentsScreen } from '@/features/appointments/mobile/mobile-appointments-screen.tsx'
import { decodeAppointmentCalendarSearch } from '@/lib/appointment-calendar-date.ts'
import { requireMerchantSession } from '@/lib/server/merchant-session.ts'

export const Route = createFileRoute('/appointments')({
  validateSearch: decodeAppointmentCalendarSearch,
  beforeLoad: async ({ location }) => requireMerchantSession(location.href),
  component: AppointmentsPage
})

function AppointmentsPage() {
  const { desktopAppointmentCalendar: calendar } = Route.useRouteContext()
  const { date } = Route.useSearch()
  if (!calendar) throw new Error('Appointments require a loaded workspace calendar.')
  const desktopAppointments = useMemo(
    () => <DesktopAppointmentsScreen calendar={calendar} selectedDate={date} />,
    [calendar, date]
  )
  useRememberDesktopWorkspace(desktopAppointments)
  return (
    <MerchantShell
      section={{ kind: 'merchant' }}
      title="Appointments"
      description="Your returning-user home: a Provider-oriented day view of accepted Appointment facts."
      layout="home"
    >
      <MerchantPresentationBoundary
        desktop={desktopAppointments}
        mobile={<MobileAppointmentsScreen calendar={calendar} selectedDate={date} />}
      />
    </MerchantShell>
  )
}
