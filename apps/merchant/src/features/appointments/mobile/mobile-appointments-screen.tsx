import type { ProviderCalendar } from '@b2b-saas-starter/capabilities/booking'
import { MobileAppointmentLedger } from './mobile-appointment-ledger.tsx'
import { MobileDateHero } from './mobile-date-hero.tsx'
import { MobileWeekStrip } from './mobile-week-strip.tsx'

export function MobileAppointmentsScreen({
  calendar,
  selectedDate
}: {
  readonly calendar: ProviderCalendar
  readonly selectedDate: string | undefined
}) {
  const date = selectedDate ?? calendar.date
  return (
    <>
      <MobileDateHero date={date} timezone={calendar.timezone} />
      <MobileWeekStrip selectedDate={date} />
      <MobileAppointmentLedger calendar={calendar} />
    </>
  )
}
