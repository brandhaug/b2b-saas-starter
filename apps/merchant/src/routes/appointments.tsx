import { useEffect, useState } from 'react'
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
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null)
  useEffect(() => {
    const value = window.sessionStorage.getItem('beesolo:last-published-public-url')
    if (value) {
      setPublishedUrl(value)
      window.sessionStorage.removeItem('beesolo:last-published-public-url')
    }
  }, [])
  return (
    <>
      {publishedUrl ? (
        <output className="m-4 block rounded-xl border bg-card p-3 text-sm md:mx-6">
          Public page published.{' '}
          <a href={publishedUrl} className="font-medium underline">
            {publishedUrl}
          </a>
        </output>
      ) : null}
      <Outlet />
    </>
  )
}
