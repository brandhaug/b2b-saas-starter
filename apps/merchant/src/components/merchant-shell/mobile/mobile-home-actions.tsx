import { Link } from '@tanstack/react-router'
import { ArrowLeft, CalendarDays, Plus, Settings } from 'lucide-react'
import { useState } from 'react'
import { MobileCalendarSheet } from './mobile-calendar-sheet.tsx'
import { useMobileSheetStack } from './mobile-sheet-stack.tsx'

export const mobileCalendarDockAction = (
  selectedDate: string,
  currentDate: string
): 'open-calendar' | 'return-today' =>
  selectedDate === currentDate ? 'open-calendar' : 'return-today'

export function MobileHomeActions({
  appointmentDate,
  currentDate,
  bookingUrl
}: {
  readonly appointmentDate: string
  readonly currentDate: string
  readonly bookingUrl: string | undefined
}) {
  const stack = useMobileSheetStack()
  const [calendarOpen, setCalendarOpen] = useState(false)
  const settingsOpen = stack?.enabled === true && stack.menuOpen
  const calendarAction = mobileCalendarDockAction(appointmentDate, currentDate)
  const sideActionClass =
    'merchant-home-action-surface grid size-14 shrink-0 place-items-center rounded-full border text-foreground transition-transform active:scale-[0.94]'
  const primaryActionClass =
    'merchant-home-action-surface grid h-14 w-24 shrink-0 place-items-center rounded-[1.75rem] border text-foreground transition-transform active:scale-[0.96]'

  return (
    <>
      <div className="merchant-home-action-fade pointer-events-none fixed inset-x-0 bottom-0 z-40 h-32" />
      <nav
        aria-label="Merchant home actions"
        className="merchant-safe-area-inline pointer-events-none fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 flex justify-center px-4"
      >
        <div className="merchant-mobile-home-action-group pointer-events-auto flex w-full items-center justify-between">
          <button
            type="button"
            aria-label="Open settings"
            aria-haspopup="dialog"
            aria-expanded={settingsOpen}
            data-mobile-home-action="settings"
            className={sideActionClass}
            onClick={() => stack?.openMenu()}
          >
            <Settings aria-hidden className="size-6" strokeWidth={2.25} />
          </button>

          {bookingUrl ? (
            <a
              href={bookingUrl}
              aria-label="New appointment"
              data-mobile-home-action="new-appointment"
              className={primaryActionClass}
            >
              <Plus aria-hidden className="size-8" strokeWidth={2.5} />
            </a>
          ) : (
            <button
              type="button"
              disabled
              aria-label="New appointment"
              title="Publish the booking page to add appointments"
              data-mobile-home-action="new-appointment"
              className={`${primaryActionClass} disabled:cursor-not-allowed disabled:opacity-45`}
            >
              <Plus aria-hidden className="size-8" strokeWidth={2.5} />
            </button>
          )}

          {calendarAction === 'return-today' ? (
            <Link
              to="/appointments"
              search={{ date: currentDate }}
              replace
              viewTransition={false}
              aria-label="Return to today"
              data-mobile-home-action="calendar"
              className={sideActionClass}
            >
              <ArrowLeft aria-hidden className="size-7" strokeWidth={2.5} />
            </Link>
          ) : (
            <button
              type="button"
              aria-label="Open calendar"
              aria-haspopup="dialog"
              aria-expanded={calendarOpen}
              data-mobile-home-action="calendar"
              className={sideActionClass}
              onClick={() => setCalendarOpen(true)}
            >
              <CalendarDays aria-hidden className="size-6" strokeWidth={2.25} />
            </button>
          )}
        </div>
      </nav>

      <MobileCalendarSheet
        open={calendarOpen}
        selectedDate={appointmentDate}
        currentDate={currentDate}
        onRequestClose={() => setCalendarOpen(false)}
      />
    </>
  )
}
