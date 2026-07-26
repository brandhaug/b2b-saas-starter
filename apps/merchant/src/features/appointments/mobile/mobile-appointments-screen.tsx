import type { ProviderCalendar } from '@b2b-saas-starter/capabilities/booking'
import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { MobileCalendarSheet } from '@/components/merchant-shell/mobile/mobile-calendar-sheet.tsx'
import { useMerchantPresentation } from '@/components/merchant-shell/merchant-presentation.tsx'
import { MobileAppointmentSummary } from './mobile-appointment-summary.tsx'
import { MobileAppointmentLedger } from './mobile-appointment-ledger.tsx'
import { MobileDateHero } from './mobile-date-hero.tsx'
import {
  mobileAppointmentLedger,
  mobileDateHeading
} from './mobile-appointments-model.ts'
import { MobileSchedulePullSurface } from './mobile-schedule-pull-surface.tsx'
import { mobileScheduleGreeting } from './mobile-schedule-pull.ts'
import { MobileWeekStrip } from './mobile-week-strip.tsx'
import { useMobileCalendarDate } from './use-mobile-calendar-date.ts'
import { appointmentDayTarget } from './week-navigation.ts'

export function MobileAppointmentsScreen({
  calendar,
  selectedDate,
  pending = false,
  previousCalendar,
  nextCalendar,
  viewerName
}: {
  readonly calendar: ProviderCalendar
  readonly selectedDate: string | undefined
  readonly pending?: boolean
  readonly previousCalendar?: ProviderCalendar | undefined
  readonly nextCalendar?: ProviderCalendar | undefined
  readonly viewerName?: string | undefined
}) {
  const date = selectedDate ?? calendar.date
  const currentDate = useMobileCalendarDate(calendar.timezone)
  const presentation = useMerchantPresentation()
  const router = useRouter()
  const mobile = presentation === 'mobile'
  const [calendarOpen, setCalendarOpen] = useState(false)
  const appointmentCount = mobileAppointmentLedger(
    calendar.providers,
    calendar.timezone
  ).length
  const [weekday = 'Selected day'] = mobileDateHeading(date).fullDate.split(',')
  const appointmentSummary = (
    <MobileAppointmentSummary
      appointmentCount={appointmentCount}
      isToday={date === currentDate}
      pending={pending}
      weekday={weekday}
    />
  )
  const selectDate = (
    nextDate: string,
    { replace = false }: { readonly replace?: boolean } = {}
  ) => {
    void router.navigate({
      to: '/appointments',
      search: { date: nextDate },
      replace,
      viewTransition: false
    })
  }
  const weekStrip = (
    <MobileWeekStrip
      selectedDate={date}
      currentDate={currentDate}
      spacing={presentation === 'desktop' ? 'desktop' : 'mobile'}
      onSelectDate={selectDate}
    />
  )
  const appointmentLedger = (
    <MobileAppointmentLedger
      calendar={calendar}
      previousCalendar={previousCalendar}
      nextCalendar={nextCalendar}
      pending={pending}
      scrollable={mobile}
      onSwipeDay={(direction) => selectDate(appointmentDayTarget(date, direction))}
    />
  )
  return (
    <div
      data-mobile-appointments-layout={mobile ? 'scrolling-ledger' : undefined}
      className={mobile ? 'flex min-h-0 flex-1 flex-col' : 'contents'}
    >
      {mobile ? (
        <>
          <MobileDateHero
            date={date}
            currentDate={currentDate}
            timezone={calendar.timezone}
            calendarOpen={calendarOpen}
            onOpenCalendar={() => setCalendarOpen(true)}
            onReturnToCurrentDay={() => selectDate(currentDate, { replace: true })}
          />
          <MobileSchedulePullSurface
            greeting={mobileScheduleGreeting(calendar.timezone, undefined, viewerName)}
            summary={appointmentSummary}
          >
            {weekStrip}
            {appointmentLedger}
          </MobileSchedulePullSurface>
          <MobileCalendarSheet
            open={calendarOpen}
            selectedDate={date}
            currentDate={currentDate}
            onRequestClose={() => setCalendarOpen(false)}
          />
        </>
      ) : (
        <div
          data-desktop-appointments-layout="fixed-week-strip"
          className="flex h-full min-h-0 flex-col"
        >
          {weekStrip}
          <div
            data-desktop-appointment-scroll="true"
            className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain"
          >
            {appointmentLedger}
          </div>
        </div>
      )}
    </div>
  )
}
