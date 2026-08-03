import type { ProviderCalendar } from '@b2b-saas-starter/capabilities/booking'
import { DesktopAppointmentRow } from '../desktop/desktop-appointment-row.tsx'
import { EmptyAppointmentDay } from '../shared/empty-appointment-day.tsx'
import { MobileAppointmentRow } from './mobile-appointment-row.tsx'
import { mobileAppointmentLedger } from './mobile-appointments-model.ts'

export function MobileAppointmentCarousel({
  calendars,
  carouselProps,
  pending,
  rowPresentation,
  scrollable
}: {
  readonly calendars: {
    readonly current: ProviderCalendar
    readonly next: ProviderCalendar | undefined
    readonly previous: ProviderCalendar | undefined
  }
  readonly carouselProps: React.HTMLAttributes<HTMLElement>
  readonly pending: boolean
  readonly rowPresentation: 'desktop' | 'mobile'
  readonly scrollable: boolean
}) {
  return (
    <section
      {...carouselProps}
      className={`${carouselProps.className ?? ''} mt-4`}
      aria-label={
        pending
          ? 'Loading appointments for selected day'
          : 'Appointments for selected day'
      }
      aria-live={pending ? 'polite' : undefined}
    >
      <div
        className={`merchant-mobile-appointment-carousel-track relative ${
          scrollable ? 'h-full min-h-0' : ''
        }`}
      >
        <AppointmentDayPanel
          calendar={calendars.previous}
          position="previous"
          rowPresentation={rowPresentation}
          scrollable={scrollable}
        />
        <AppointmentDayPanel
          calendar={calendars.current}
          pending={pending}
          position="current"
          rowPresentation={rowPresentation}
          scrollable={scrollable}
        />
        <AppointmentDayPanel
          calendar={calendars.next}
          position="next"
          rowPresentation={rowPresentation}
          scrollable={scrollable}
        />
      </div>
    </section>
  )
}

function AppointmentDayPanel({
  calendar,
  pending = false,
  position,
  rowPresentation,
  scrollable
}: {
  readonly calendar: ProviderCalendar | undefined
  readonly pending?: boolean
  readonly position: 'current' | 'next' | 'previous'
  readonly rowPresentation: 'desktop' | 'mobile'
  readonly scrollable: boolean
}) {
  const appointments =
    calendar && !pending
      ? mobileAppointmentLedger(calendar.providers, calendar.timezone)
      : []
  const current = position === 'current'
  const mobilePanelClass = current
    ? `merchant-mobile-appointment-scrollport relative h-full min-h-0 overflow-x-hidden overflow-y-auto overscroll-y-contain ${
        appointments.length > 0 ? 'pb-[calc(8rem+env(safe-area-inset-bottom))]' : ''
      }`
    : `absolute top-0 h-full min-h-0 overflow-hidden ${
        position === 'previous' ? 'right-full' : 'left-full'
      }`
  return (
    <div
      data-mobile-appointment-day-panel={position}
      data-mobile-appointment-day={calendar?.date}
      data-mobile-appointment-scroll={scrollable && current ? 'true' : undefined}
      className={`merchant-mobile-appointment-day-panel w-full px-0.5 ${
        scrollable ? mobilePanelClass : current ? 'relative' : 'hidden'
      }`}
      aria-hidden={current ? undefined : true}
      inert={current ? undefined : true}
    >
      {!calendar || pending ? (
        <>
          {position === 'current' ? (
            <span className="sr-only">Loading appointments…</span>
          ) : null}
          <div className="grid gap-2 px-1" aria-hidden>
            <div className="h-16 animate-pulse rounded-2xl bg-card/70" />
            <div className="h-16 animate-pulse rounded-2xl bg-card/45" />
          </div>
        </>
      ) : appointments.length === 0 ? (
        <EmptyAppointmentDay />
      ) : (
        <ol>
          {appointments.map((appointment) =>
            rowPresentation === 'desktop' ? (
              <DesktopAppointmentRow
                key={appointment.id}
                appointment={appointment}
                date={calendar.date}
              />
            ) : (
              <MobileAppointmentRow
                key={appointment.id}
                appointment={appointment}
                date={calendar.date}
              />
            )
          )}
        </ol>
      )}
    </div>
  )
}
