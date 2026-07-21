import type { ProviderCalendar } from '@b2b-saas-starter/capabilities/booking'
import { MobileAppointmentLedger } from './mobile-appointment-ledger.tsx'
import { MobileDateHero } from './mobile-date-hero.tsx'
import { MobileWeekStrip } from './mobile-week-strip.tsx'
import { useMobileCalendarDate } from './use-mobile-calendar-date.ts'

export function MobileAppointmentsScreen({
  calendar,
  selectedDate
}: {
  readonly calendar: ProviderCalendar
  readonly selectedDate: string | undefined
}) {
  const date = selectedDate ?? calendar.date
  const currentDate = useMobileCalendarDate(calendar.timezone)
  return (
    <>
      <MobileDateHero
        date={date}
        currentDate={currentDate}
        timezone={calendar.timezone}
      />
      <MobileWeekStrip selectedDate={date} currentDate={currentDate} />
      <MobileAppointmentLedger calendar={calendar} />
    </>
  )
}
