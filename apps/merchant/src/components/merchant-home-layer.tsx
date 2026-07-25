import { useQuery } from '@tanstack/react-query'
import { MerchantShell } from '@/components/merchant-shell/index.ts'
import { MobileAppointmentsScreen } from '@/features/appointments/mobile/mobile-appointments-screen.tsx'
import { appointmentDayTarget } from '@/features/appointments/mobile/week-navigation.ts'
import { merchantHomeDate } from '@/lib/merchant-home-date.ts'
import {
  merchantHomeCalendarQuery,
  merchantPublicBookingUrlQuery
} from '@/lib/merchant-home-queries.ts'

export function MerchantHomeLayer({
  href,
  search,
  state,
  overlayOpen,
  viewerName
}: {
  readonly href: string
  readonly search: unknown
  readonly state: unknown
  readonly overlayOpen: boolean
  readonly viewerName: string | undefined
}) {
  const requestedDate = merchantHomeDate(search, state)
  const calendar = useQuery(merchantHomeCalendarQuery(requestedDate, href))
  const bookingUrl = useQuery(merchantPublicBookingUrlQuery())
  const selectedDate = requestedDate ?? calendar.data?.date
  const previousDate = selectedDate
    ? appointmentDayTarget(selectedDate, 'previous')
    : undefined
  const nextDate = selectedDate ? appointmentDayTarget(selectedDate, 'next') : undefined
  const previousCalendar = useQuery({
    ...merchantHomeCalendarQuery(previousDate, href),
    enabled: previousDate !== undefined
  })
  const nextCalendar = useQuery({
    ...merchantHomeCalendarQuery(nextDate, href),
    enabled: nextDate !== undefined
  })
  const calendarPending =
    calendar.isPending ||
    calendar.isPlaceholderData ||
    (selectedDate !== undefined && calendar.data?.date !== selectedDate)

  if (!calendar.data || !selectedDate) {
    return (
      <main
        data-merchant-home-layer="true"
        className="merchant-home-layer grid min-h-dvh place-items-center px-6"
        aria-hidden={overlayOpen || undefined}
        inert={overlayOpen || undefined}
      >
        <output className="text-sm text-muted-foreground">Loading appointments…</output>
      </main>
    )
  }

  return (
    <div
      data-merchant-home-layer="true"
      className="merchant-home-layer"
      aria-hidden={overlayOpen || undefined}
      inert={overlayOpen || undefined}
    >
      <MerchantShell
        section={{ kind: 'merchant' }}
        title="Appointments"
        description="Your returning-user home: a Provider-oriented day view of accepted Appointment facts."
        headerDate={selectedDate}
        headerTimezone={calendar.data.timezone}
        bookingUrl={bookingUrl.data ?? undefined}
        layout="home"
      >
        <MobileAppointmentsScreen
          calendar={calendar.data}
          selectedDate={selectedDate}
          pending={calendarPending}
          previousCalendar={
            previousCalendar.data?.date === previousDate
              ? previousCalendar.data
              : undefined
          }
          nextCalendar={
            nextCalendar.data?.date === nextDate ? nextCalendar.data : undefined
          }
          viewerName={viewerName}
        />
      </MerchantShell>
    </div>
  )
}
