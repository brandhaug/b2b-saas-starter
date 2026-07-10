import * as stylex from '@stylexjs/stylex'
import { CalendarDays, Menu } from 'lucide-react'
import { useMemo, useState } from 'react'
import type {
  BookingAvailability,
  BookingTimeSlot
} from '@b2b-saas-starter/capabilities'
import { styles } from './booking-flow.styles.ts'

export function BookingSchedulingFlow({
  availability,
  busy,
  slotLost,
  onSelect
}: {
  readonly availability: BookingAvailability
  readonly busy: boolean
  readonly slotLost: boolean
  readonly onSelect: (startsAt: string) => void
}) {
  const days = useMemo(
    () => calendarDays(availability.slots, availability.timezone),
    [availability.slots, availability.timezone]
  )
  const heldDate = availability.hold
    ? localDate(availability.hold.quote.startsAt, availability.timezone)
    : null
  const [chosenDate, setChosenDate] = useState<string | null>(
    heldDate ?? days[0] ?? null
  )
  const activeDate =
    chosenDate && days.includes(chosenDate) ? chosenDate : (days[0] ?? null)
  const visible = availability.slots.filter(
    (slot) => localDate(slot.startsAt, availability.timezone) === activeDate
  )

  return (
    <div {...stylex.props(styles.app)} aria-busy={busy}>
      <div {...stylex.props(styles.widget)}>
        <header {...stylex.props(styles.header)}>
          <span {...stylex.props(styles.iconButton)} aria-hidden="true">
            <CalendarDays {...stylex.props(styles.icon16)} />
          </span>
          <h1 {...stylex.props(styles.title)}>Choose your appointment</h1>
          <button
            type="button"
            aria-label="Booking menu"
            {...stylex.props(styles.iconButton)}
          >
            <Menu {...stylex.props(styles.icon16)} />
          </button>
        </header>
        <main {...stylex.props(styles.main)}>
          {slotLost ? (
            <div {...stylex.props(styles.alert)}>
              <p {...stylex.props(styles.alertTitle)}>That time was just booked</p>
              <p {...stylex.props(styles.alertCopy)}>
                Your service choices are still saved.
              </p>
            </div>
          ) : null}
          {availability.slots.length === 0 ? (
            <div {...stylex.props(styles.empty)}>
              <span {...stylex.props(styles.emptyIcon)}>
                <CalendarDays {...stylex.props(styles.icon20)} />
              </span>
              <h2 {...stylex.props(styles.emptyTitle)}>No times in the next 14 days</h2>
              <p {...stylex.props(styles.emptyCopy)}>
                Your professional and service choices are still saved.
              </p>
            </div>
          ) : (
            <>
              <p {...stylex.props(styles.month)}>
                {monthLabel(activeDate!, availability.timezone)}
              </p>
              <div {...stylex.props(styles.dateGrid)}>
                {days.map((date) => (
                  <button
                    key={date}
                    type="button"
                    aria-label={longDate(date, availability.timezone)}
                    onClick={() => setChosenDate(date)}
                    {...stylex.props(styles.dateCell, styles.dateButton)}
                  >
                    <span
                      {...stylex.props(
                        styles.dateCircle,
                        date === activeDate && styles.activeDate
                      )}
                    >
                      {date.slice(-2).replace(/^0/, '')}
                    </span>
                    <span {...stylex.props(styles.dayLabel)}>
                      {weekday(date, availability.timezone)}
                    </span>
                  </button>
                ))}
              </div>
              <p {...stylex.props(styles.dayHeading)}>
                {longDate(activeDate!, availability.timezone)}
              </p>
              <div {...stylex.props(styles.timeGrid)}>
                {visible.map((slot) => {
                  const selected = availability.hold?.quote.startsAt === slot.startsAt
                  return (
                    <button
                      key={slot.startsAt}
                      type="button"
                      disabled={busy}
                      aria-label={timeLabel(slot.startsAt, availability.timezone)}
                      onClick={() => onSelect(slot.startsAt)}
                      {...stylex.props(
                        styles.timeButton,
                        selected && styles.selectedTime
                      )}
                    >
                      {timeLabel(slot.startsAt, availability.timezone)}
                    </button>
                  )
                })}
              </div>
              {availability.hold ? (
                <p {...stylex.props(styles.selectedTimeFeedback)}>
                  Selected with {availability.hold.quote.assignedProvider.displayName} ·
                  held for checkout
                </p>
              ) : null}
            </>
          )}
        </main>
      </div>
    </div>
  )
}

const localDate = (instant: string, timezone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(instant))

const addDay = (date: string, offset: number) => {
  const value = new Date(`${date}T12:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + offset)
  return value.toISOString().slice(0, 10)
}

const calendarDays = (slots: readonly BookingTimeSlot[], timezone: string) => {
  if (!slots[0]) return []
  const first = localDate(slots[0].startsAt, timezone)
  return Array.from({ length: 6 }, (_, index) => addDay(first, index))
}

const asLocalNoon = (date: string) => new Date(`${date}T12:00:00.000Z`)
const monthLabel = (date: string, timezone: string) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    month: 'long',
    year: 'numeric'
  }).format(asLocalNoon(date))
const longDate = (date: string, timezone: string) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  }).format(asLocalNoon(date))
const weekday = (date: string, timezone: string) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short'
  }).format(asLocalNoon(date))
const timeLabel = (instant: string, timezone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(instant))
