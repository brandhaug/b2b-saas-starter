import * as stylex from '@stylexjs/stylex'
import { useMemo, useState } from 'react'
import type {
  BookingAvailability,
  BookingTimeSlot
} from '@b2b-saas-starter/capabilities/booking'
import { BookingVisualAsset } from '../assets/booking-visual-asset.tsx'
import {
  translateBookingMessage,
  type BookingLocale,
  type BookingTranslationKey
} from '../localization/booking-localization.ts'
import { styles } from './booking-flow.styles.ts'

export function BookingSchedulingFlow({
  availability,
  busy,
  slotLost,
  holdExpired = false,
  locale = 'en',
  onSelect,
  onRelease,
  onCheckout,
  checkoutLabel
}: {
  readonly availability: BookingAvailability
  readonly busy: boolean
  readonly slotLost: boolean
  readonly holdExpired?: boolean
  readonly locale?: BookingLocale
  readonly onSelect: (startsAt: string) => void
  readonly onRelease?: () => void
  readonly onCheckout?: () => void
  readonly checkoutLabel?: string
}) {
  const message = (key: BookingTranslationKey) => translateBookingMessage(locale, key)
  const formatters = useMemo(
    () => ({
      date: new Intl.DateTimeFormat('en-CA', {
        timeZone: availability.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }),
      month: new Intl.DateTimeFormat(locale, {
        timeZone: availability.timezone,
        month: 'long',
        year: 'numeric'
      }),
      longDate: new Intl.DateTimeFormat(locale, {
        timeZone: availability.timezone,
        weekday: 'long',
        month: 'long',
        day: 'numeric'
      }),
      weekday: new Intl.DateTimeFormat(locale, {
        timeZone: availability.timezone,
        weekday: 'short'
      }),
      time: new Intl.DateTimeFormat(locale, {
        timeZone: availability.timezone,
        hour: '2-digit',
        minute: '2-digit'
      })
    }),
    [availability.timezone, locale]
  )
  const localDate = (instant: string) => formatters.date.format(new Date(instant))
  const days = useMemo(
    () => calendarDays(availability.slots, formatters.date),
    [availability.slots, formatters.date]
  )
  const heldDate = availability.hold
    ? localDate(availability.hold.quote.startsAt)
    : null
  const [chosenDate, setChosenDate] = useState<string | null>(
    heldDate ?? days[0] ?? null
  )
  const [page, setPage] = useState(0)
  const visibleDays = days.slice(page * 6, page * 6 + 6)
  const activeDate =
    chosenDate && visibleDays.includes(chosenDate)
      ? chosenDate
      : (visibleDays[0] ?? null)
  const visible = availability.slots.filter(
    (slot) => localDate(slot.startsAt) === activeDate
  )

  return (
    <div {...stylex.props(styles.widget)}>
      <header {...stylex.props(styles.header)}>
        <span {...stylex.props(styles.iconButton)} aria-hidden="true">
          <BookingVisualAsset
            assetRole="calendar-scheduling"
            {...stylex.props(styles.icon16)}
          />
        </span>
        <h1 {...stylex.props(styles.title)}>{message('scheduling.choose_title')}</h1>
        <button
          type="button"
          aria-label="Booking menu"
          {...stylex.props(styles.iconButton)}
        >
          <BookingVisualAsset
            assetRole="navigation-menu"
            {...stylex.props(styles.icon16)}
          />
        </button>
      </header>
      <main {...stylex.props(styles.main)}>
        {slotLost || holdExpired ? (
          <div {...stylex.props(styles.alert)}>
            <p {...stylex.props(styles.alertTitle)}>
              {holdExpired
                ? message('scheduling.expired_title')
                : message('status.slot_lost')}
            </p>
            <p {...stylex.props(styles.alertCopy)}>
              {message('scheduling.saved_copy')}
            </p>
          </div>
        ) : null}
        {availability.slots.length === 0 && availability.hold ? (
          <div {...stylex.props(styles.empty)}>
            <span {...stylex.props(styles.emptyIcon)}>
              <BookingVisualAsset
                assetRole="calendar-scheduling"
                {...stylex.props(styles.icon20)}
              />
            </span>
            <h2 {...stylex.props(styles.emptyTitle)}>
              {message('scheduling.held_title')}
            </h2>
            <p {...stylex.props(styles.emptyCopy)}>
              {formatters.longDate.format(new Date(availability.hold.quote.startsAt))}{' '}
              at {formatters.time.format(new Date(availability.hold.quote.startsAt))}
              {' · '}
              {availability.hold.quote.assignedProvider.displayName}
            </p>
            <p {...stylex.props(styles.selectedTimeFeedback)}>
              {message('scheduling.held_copy')}
            </p>
          </div>
        ) : availability.slots.length === 0 ? (
          <div {...stylex.props(styles.empty)}>
            <span {...stylex.props(styles.emptyIcon)}>
              <BookingVisualAsset
                assetRole="calendar-scheduling"
                {...stylex.props(styles.icon20)}
              />
            </span>
            <h2 {...stylex.props(styles.emptyTitle)}>
              {message('scheduling.empty_title')}
            </h2>
            <p {...stylex.props(styles.emptyCopy)}>
              {message('scheduling.empty_copy')}
            </p>
          </div>
        ) : (
          <>
            <p {...stylex.props(styles.month)}>
              {formatters.month.format(asLocalNoon(activeDate!))}
            </p>
            <div {...stylex.props(styles.calendarControls)}>
              <button
                type="button"
                disabled={page === 0}
                onClick={() => {
                  const nextPage = page - 1
                  setPage(nextPage)
                  setChosenDate(days[nextPage * 6] ?? null)
                }}
                {...stylex.props(styles.textButton)}
              >
                {message('scheduling.previous')}
              </button>
              <button
                type="button"
                disabled={(page + 1) * 6 >= days.length}
                onClick={() => {
                  const nextPage = page + 1
                  setPage(nextPage)
                  setChosenDate(days[nextPage * 6] ?? null)
                }}
                {...stylex.props(styles.textButton)}
              >
                {message('scheduling.next')}
              </button>
            </div>
            <div {...stylex.props(styles.dateGrid)}>
              {visibleDays.map((date) => (
                <button
                  key={date}
                  type="button"
                  aria-label={formatters.longDate.format(asLocalNoon(date))}
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
                    {formatters.weekday.format(asLocalNoon(date))}
                  </span>
                </button>
              ))}
            </div>
            <p {...stylex.props(styles.dayHeading)}>
              {formatters.longDate.format(asLocalNoon(activeDate!))}
            </p>
            <div {...stylex.props(styles.timeGrid)}>
              {visible.map((slot) => {
                const selected = availability.hold?.quote.startsAt === slot.startsAt
                return (
                  <button
                    key={slot.startsAt}
                    type="button"
                    disabled={busy}
                    aria-label={formatters.time.format(new Date(slot.startsAt))}
                    onClick={() => onSelect(slot.startsAt)}
                    {...stylex.props(
                      styles.timeButton,
                      selected && styles.selectedTime
                    )}
                  >
                    {formatters.time.format(new Date(slot.startsAt))}
                  </button>
                )
              })}
            </div>
            {availability.hold ? (
              <p {...stylex.props(styles.selectedTimeFeedback)}>
                {message('scheduling.selected_with')}{' '}
                {availability.hold.quote.assignedProvider.displayName} ·{' '}
                {message('scheduling.held_for_checkout')}
              </p>
            ) : null}
          </>
        )}
        {availability.hold && onCheckout ? (
          <div {...stylex.props(styles.inlineActions)}>
            {onRelease ? (
              <button
                type="button"
                disabled={busy}
                onClick={onRelease}
                {...stylex.props(styles.textButton)}
              >
                {message('action.release_time')}
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              disabled={busy}
              onClick={onCheckout}
              {...stylex.props(styles.primaryButton)}
            >
              {checkoutLabel ?? message('action.checkout')}
            </button>
          </div>
        ) : null}
      </main>
    </div>
  )
}

const addDay = (date: string, offset: number) => {
  const value = new Date(`${date}T12:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + offset)
  return value.toISOString().slice(0, 10)
}

const calendarDays = (
  slots: readonly BookingTimeSlot[],
  formatter: Intl.DateTimeFormat
) => {
  if (!slots[0]) return []
  const first = formatter.format(new Date(slots[0].startsAt))
  return Array.from({ length: 14 }, (_, index) => addDay(first, index))
}

const asLocalNoon = (date: string) => new Date(`${date}T12:00:00.000Z`)
