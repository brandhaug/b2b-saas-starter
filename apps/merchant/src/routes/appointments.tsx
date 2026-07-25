import { createFileRoute, Outlet } from '@tanstack/react-router'
import { decodeAppointmentCalendarSearch } from '@/lib/appointment-calendar-date.ts'
import { merchantHomeCalendarQuery } from '@/lib/merchant-home-queries.ts'
import { requireMerchantSession } from '@/lib/server/merchant-session.ts'

export const Route = createFileRoute('/appointments')({
  validateSearch: decodeAppointmentCalendarSearch,
  loaderDeps: ({ search }) => ({ date: search.date }),
  beforeLoad: async ({ cause, location }) => {
    if (cause !== 'enter') return
    await requireMerchantSession(location.href)
  },
  loader: ({ cause, context, deps, location }) => {
    const calendarQuery = merchantHomeCalendarQuery(deps.date, location.href)
    if (cause === 'stay') {
      void context.queryClient.prefetchQuery(calendarQuery)
      return
    }
    return context.queryClient.ensureQueryData(calendarQuery)
  },
  component: AppointmentsRoute
})

function AppointmentsRoute() {
  return <Outlet />
}
