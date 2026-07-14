import * as stylex from '@stylexjs/stylex'
import {
  AnimatePresence,
  LazyMotion,
  domAnimation,
  m,
  type Variants
} from 'motion/react'
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
import {
  BookingPremiumThemeBoundary,
  type BookingPremiumPalette
} from '../presentation/booking-premium-theme.tsx'
import { BookingWidgetShell } from './booking-widget-shell.tsx'
import { RouteTitlePresence } from '../presentation/booking-primitives.tsx'

export function BookingSchedulingFlow({
  availability,
  busy,
  slotLost,
  holdExpired = false,
  locale = 'en',
  onSelect,
  onBack,
  onRelease,
  onCheckout,
  checkoutLabel,
  onTitleActionMount,
  premiumPalette = null
}: {
  readonly availability: BookingAvailability
  readonly busy: boolean
  readonly slotLost: boolean
  readonly holdExpired?: boolean
  readonly locale?: BookingLocale
  readonly onSelect: (startsAt: string) => void
  readonly onBack: () => void
  readonly onRelease?: () => void
  readonly onCheckout?: () => void
  readonly checkoutLabel?: string
  readonly onTitleActionMount?: (element: HTMLDivElement | null) => void
  readonly premiumPalette?: BookingPremiumPalette | null
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
        hour: 'numeric',
        minute: '2-digit'
      })
    }),
    [availability.timezone, locale]
  )
  const localDate = (instant: string) => formatters.date.format(new Date(instant))
  const today = formatters.date.format(new Date())
  const scheduleSlots = useMemo(() => {
    const held = availability.hold?.quote
    if (!held || availability.slots.some((slot) => slot.startsAt === held.startsAt))
      return availability.slots
    return [
      ...availability.slots,
      { startsAt: held.startsAt, endsAt: held.endsAt }
    ].sort((left, right) => left.startsAt.localeCompare(right.startsAt))
  }, [availability.hold, availability.slots])
  const days = useMemo(
    () => calendarDays(scheduleSlots, formatters.date, today),
    [scheduleSlots, formatters.date, today]
  )
  const daySet = useMemo(() => new Set(days), [days])
  const availableDaySet = useMemo(
    () =>
      new Set(
        scheduleSlots.map((slot) => formatters.date.format(new Date(slot.startsAt)))
      ),
    [scheduleSlots, formatters.date]
  )
  const heldDate = availability.hold
    ? localDate(availability.hold.quote.startsAt)
    : null
  const [chosenDate, setChosenDate] = useState<string | null>(
    heldDate ?? (scheduleSlots[0] ? localDate(scheduleSlots[0].startsAt) : null)
  )
  const [calendarExpanded, setCalendarExpanded] = useState(false)
  const chosenIndex = chosenDate ? days.indexOf(chosenDate) : 0
  const lineStart = Math.max(0, Math.floor(Math.max(0, chosenIndex) / 6) * 6)
  const visibleDays = days.slice(lineStart, lineStart + 6)
  const activeDate =
    chosenDate && visibleDays.includes(chosenDate)
      ? chosenDate
      : (visibleDays[0] ?? null)
  const visible = scheduleSlots.filter(
    (slot) => localDate(slot.startsAt) === activeDate
  )
  const nextAvailableDate = activeDate
    ? days.find((date) => date > activeDate && availableDaySet.has(date))
    : undefined
  const [displayMonth, setDisplayMonth] = useState(() =>
    (activeDate ?? days[0] ?? '').slice(0, 7)
  )
  const [monthDirection, setMonthDirection] = useState<-1 | 1>(1)
  const firstMonth = days[0]?.slice(0, 7) ?? displayMonth
  const lastMonth = days.at(-1)?.slice(0, 7) ?? displayMonth

  return (
    <BookingPremiumThemeBoundary palette={premiumPalette}>
      <BookingWidgetShell busy={busy} busyLabel={message('feedback.loading')}>
        <div data-testid="container:title" {...stylex.props(styles.header)}>
          <button
            type="button"
            aria-label={message('action.back')}
            data-testid="btn:back"
            onClick={onBack}
            {...stylex.props(styles.iconButton, styles.backButton)}
          >
            <BookingVisualAsset
              assetRole="navigation-back"
              {...stylex.props(styles.backIcon)}
            />
          </button>
          <RouteTitlePresence presenceKey={message('scheduling.choose_title')}>
            <p {...stylex.props(styles.title)}>{message('scheduling.choose_title')}</p>
          </RouteTitlePresence>
          {onTitleActionMount ? (
            <div ref={onTitleActionMount} {...stylex.props(styles.titleActions)} />
          ) : null}
        </div>
        <main data-testid="container:scrollable" {...stylex.props(styles.main)}>
          {slotLost || holdExpired ? (
            <div {...stylex.props(styles.alert, styles.scheduleTopOffset)}>
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
            <div
              {...stylex.props(
                styles.empty,
                !slotLost && !holdExpired && styles.scheduleTopOffset
              )}
            >
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
            <div
              {...stylex.props(
                styles.empty,
                !slotLost && !holdExpired && styles.scheduleTopOffset
              )}
            >
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
              <div
                {...stylex.props(
                  styles.scheduleCalendar,
                  !slotLost && !holdExpired && styles.scheduleTopOffset
                )}
              >
                <div {...stylex.props(styles.calendarHeader)}>
                  <p data-testid="text:currentMonth" {...stylex.props(styles.month)}>
                    {formatters.month.format(
                      asLocalNoon(
                        `${calendarExpanded ? displayMonth : activeDate!.slice(0, 7)}-01`
                      )
                    )}
                  </p>
                  {calendarExpanded ? (
                    <div {...stylex.props(styles.fullCalendarControls)}>
                      <button
                        type="button"
                        onClick={() => {
                          setChosenDate(daySet.has(today) ? today : (days[0] ?? null))
                          setCalendarExpanded(false)
                        }}
                        {...stylex.props(styles.calendarTextControl)}
                      >
                        {message('scheduling.today')}
                      </button>
                      <button
                        type="button"
                        aria-label={message('scheduling.previous_month')}
                        disabled={displayMonth <= firstMonth}
                        onClick={() => {
                          setMonthDirection(-1)
                          setDisplayMonth(addMonth(displayMonth, -1))
                        }}
                        {...stylex.props(styles.calendarArrowControl)}
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        aria-label={message('scheduling.next_month')}
                        disabled={displayMonth >= lastMonth}
                        onClick={() => {
                          setMonthDirection(1)
                          setDisplayMonth(addMonth(displayMonth, 1))
                        }}
                        {...stylex.props(styles.calendarArrowControl)}
                      >
                        ›
                      </button>
                    </div>
                  ) : null}
                </div>
                <LazyMotion features={domAnimation} strict>
                  <m.div layout="size" transition={{ duration: 0.3 }}>
                    <AnimatePresence initial={false} mode="wait">
                      {calendarExpanded ? (
                        <m.div
                          key="calendar"
                          data-testid="calendarMonth"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.3 }}
                          {...stylex.props(styles.expandedCalendar)}
                        >
                          <div {...stylex.props(styles.weekdayGrid)}>
                            {calendarWeekdays(formatters.weekday).map((label) => (
                              <span key={label}>{label}</span>
                            ))}
                          </div>
                          <div {...stylex.props(styles.monthSlideViewport)}>
                            <AnimatePresence
                              initial={false}
                              custom={monthDirection}
                              mode="sync"
                            >
                              <m.div
                                key={displayMonth}
                                custom={monthDirection}
                                variants={calendarSlideVariants}
                                initial="enter"
                                animate="center"
                                exit="exit"
                                transition={{ duration: 0.6 }}
                                {...stylex.props(styles.monthSlide)}
                              >
                                <div {...stylex.props(styles.monthGrid)}>
                                  {calendarMonthDays(`${displayMonth}-01`).map(
                                    (date) => {
                                      const enabled =
                                        daySet.has(date) && availableDaySet.has(date)
                                      return (
                                        <button
                                          key={date}
                                          type="button"
                                          disabled={!enabled}
                                          aria-label={formatters.longDate.format(
                                            asLocalNoon(date)
                                          )}
                                          aria-pressed={date === activeDate}
                                          onClick={() => {
                                            setChosenDate(date)
                                            setCalendarExpanded(false)
                                          }}
                                          {...stylex.props(
                                            styles.monthDay,
                                            styles.dateButton,
                                            date.slice(0, 7) !== displayMonth &&
                                              styles.outsideMonthDay,
                                            enabled && styles.availableMonthDay,
                                            date === activeDate &&
                                              styles.selectedMonthDay
                                          )}
                                        >
                                          {date.slice(-2).replace(/^0/, '')}
                                        </button>
                                      )
                                    }
                                  )}
                                </div>
                              </m.div>
                            </AnimatePresence>
                          </div>
                          <p {...stylex.props(styles.expandedMonthName)}>
                            {formatters.month
                              .format(asLocalNoon(`${displayMonth}-01`))
                              .replace(/\s+\d{4}$/, '')}
                          </p>
                        </m.div>
                      ) : (
                        <m.div
                          key="line"
                          data-testid="calendarLine"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.3 }}
                          {...stylex.props(styles.dateGrid)}
                        >
                          {visibleDays.map((date) => (
                            <CalendarLineDay
                              key={date}
                              date={date}
                              activeDate={activeDate}
                              available={availableDaySet.has(date)}
                              longDate={formatters.longDate}
                              weekday={formatters.weekday}
                              onChoose={setChosenDate}
                            />
                          ))}
                          <button
                            type="button"
                            aria-label={message('scheduling.show_full_calendar')}
                            data-testid="btn:expandCalendar"
                            onClick={() => {
                              setDisplayMonth(activeDate!.slice(0, 7))
                              setCalendarExpanded(true)
                            }}
                            {...stylex.props(styles.dateCell, styles.dateButton)}
                          >
                            <span {...stylex.props(styles.expandCircle)}>
                              <svg
                                width="12"
                                height="6"
                                viewBox="0 0 12 6"
                                aria-hidden="true"
                              >
                                <path
                                  d="M6 5.992a.75.75 0 0 0 .545-.246l4.453-4.559a.667.667 0 0 0 .2-.486.69.69 0 0 0-.692-.697.715.715 0 0 0-.504.21L6.006 4.323 1.998.215a.73.73 0 0 0-.504-.211A.69.69 0 0 0 .803.7c0 .194.07.358.199.487L5.46 5.745A.725.725 0 0 0 6 5.992Z"
                                  fill="currentColor"
                                />
                              </svg>
                            </span>
                          </button>
                        </m.div>
                      )}
                    </AnimatePresence>
                  </m.div>
                </LazyMotion>
              </div>
              <p data-testid="text:selectedDate" {...stylex.props(styles.dayHeading)}>
                {formatters.longDate.format(asLocalNoon(activeDate!))}
              </p>
              <LazyMotion features={domAnimation} strict>
                <AnimatePresence initial={false} mode="wait">
                  <m.div
                    key={activeDate}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    {...stylex.props(styles.timeGrid)}
                  >
                    {visible.length === 0 && nextAvailableDate ? (
                      <button
                        type="button"
                        data-testid="btn:chooseTime:nextTime"
                        aria-label={message('scheduling.next_time')}
                        onClick={() => setChosenDate(nextAvailableDate)}
                        {...stylex.props(styles.timeButton, styles.nextTimeButton)}
                      >
                        <svg
                          width="15"
                          height="13"
                          viewBox="0 0 15 13"
                          aria-hidden="true"
                          {...stylex.props(styles.nextTimeIcon)}
                        >
                          <path
                            fill="currentColor"
                            d="M14.938 6.697c0-.256-.11-.52-.293-.696l-4.79-4.79c-.206-.205-.44-.3-.674-.3-.542 0-.923.388-.923.894 0 .278.117.498.285.674l1.663 1.67 1.853 1.699-1.648-.088H1.834c-.578 0-.966.38-.966.937s.388.938.966.938h8.577l1.648-.096-1.853 1.707-1.663 1.663c-.168.175-.285.395-.285.673 0 .513.38.894.923.894.234 0 .461-.095.659-.293l4.805-4.79c.183-.183.293-.44.293-.696Z"
                          />
                        </svg>
                        {message('scheduling.next_time')}
                      </button>
                    ) : null}
                    {visible.map((slot) => {
                      const selected =
                        availability.hold?.quote.startsAt === slot.startsAt
                      return (
                        <button
                          key={slot.startsAt}
                          type="button"
                          disabled={busy}
                          aria-label={formatters.time.format(new Date(slot.startsAt))}
                          data-testid={`btn:chooseTime:time:${slot.startsAt}${selected ? ':selected' : ''}`}
                          onClick={() => onSelect(slot.startsAt)}
                          {...stylex.props(
                            styles.timeButton,
                            selected && styles.selectedTime
                          )}
                        >
                          {formatters.time
                            .format(new Date(slot.startsAt))
                            .toLocaleLowerCase(locale)}
                        </button>
                      )
                    })}
                  </m.div>
                </AnimatePresence>
              </LazyMotion>
            </>
          )}
          {availability.slots.length === 0 && availability.hold && onCheckout ? (
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
        <LazyMotion features={domAnimation} strict>
          <AnimatePresence>
            {availability.slots.length > 0 && availability.hold && onCheckout ? (
              <m.div
                key="viewOrderSafeArea"
                data-testid="container:viewOrderSafeArea"
                initial={{ scale: 0.8, y: 88 }}
                animate={{ scale: 1, y: 0 }}
                exit={{
                  scale: 0.8,
                  y: 88,
                  transition: { duration: 0.15, delay: 0.15, ease: 'easeInOut' }
                }}
                transition={{ duration: 0.2, delay: 0.2, ease: 'easeInOut' }}
                {...stylex.props(styles.orderBarSafeArea)}
              >
                <button
                  type="button"
                  data-testid="btn:viewOrder"
                  aria-label={`${message('action.view_order')}, ${formatMoney(
                    availability.hold.quote.totalMinor,
                    availability.hold.quote.currency,
                    locale
                  )}`}
                  onClick={onCheckout}
                  {...stylex.props(styles.orderBar)}
                >
                  <span>{message('action.view_order')}</span>
                  <span {...stylex.props(styles.orderBarTotal)}>
                    {formatMoney(
                      availability.hold.quote.totalMinor,
                      availability.hold.quote.currency,
                      locale
                    )}
                  </span>
                </button>
              </m.div>
            ) : null}
          </AnimatePresence>
        </LazyMotion>
      </BookingWidgetShell>
    </BookingPremiumThemeBoundary>
  )
}

const addDay = (date: string, offset: number) => {
  const value = new Date(`${date}T12:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + offset)
  return value.toISOString().slice(0, 10)
}

const calendarDays = (
  slots: readonly BookingTimeSlot[],
  formatter: Intl.DateTimeFormat,
  today: string
) => {
  if (!slots[0]) return []
  const firstSlot = formatter.format(new Date(slots[0].startsAt))
  const first = firstSlot < today ? firstSlot : today
  return Array.from({ length: 14 }, (_, index) => addDay(first, index))
}

const asLocalNoon = (date: string) => new Date(`${date}T12:00:00.000Z`)

function CalendarLineDay({
  date,
  activeDate,
  available,
  longDate,
  weekday,
  onChoose
}: {
  readonly date: string
  readonly activeDate: string | null
  readonly available: boolean
  readonly longDate: Intl.DateTimeFormat
  readonly weekday: Intl.DateTimeFormat
  readonly onChoose: (date: string) => void
}) {
  const selected = date === activeDate
  return (
    <button
      type="button"
      disabled={!available}
      aria-label={longDate.format(asLocalNoon(date))}
      aria-pressed={selected}
      data-testid={`btn:day:${date}`}
      onClick={() => onChoose(date)}
      {...stylex.props(styles.dateCell, styles.dateButton)}
    >
      <span
        {...stylex.props(
          styles.dateCircle,
          available && styles.availableDate,
          selected && styles.activeDate
        )}
      >
        <span {...stylex.props(styles.dateCircleBorder)}>
          {date.slice(-2).replace(/^0/, '')}
        </span>
      </span>
      <span {...stylex.props(styles.dayLabel, selected && styles.activeDayLabel)}>
        {weekday.format(asLocalNoon(date)).replace('.', '')}
      </span>
    </button>
  )
}

const calendarMonthDays = (date: string) => {
  const month = date.slice(0, 7)
  const first = `${month}-01`
  const startWeekday = asLocalNoon(first).getUTCDay()
  const firstCell = addDay(first, -startWeekday)
  return Array.from({ length: 42 }, (_, index) => addDay(firstCell, index))
}

const addMonth = (month: string, offset: number) => {
  const value = new Date(`${month}-01T12:00:00.000Z`)
  value.setUTCMonth(value.getUTCMonth() + offset)
  return value.toISOString().slice(0, 7)
}

const calendarWeekdays = (formatter: Intl.DateTimeFormat) =>
  Array.from({ length: 7 }, (_, index) =>
    formatter.format(asLocalNoon(addDay('2026-07-12', index))).replace('.', '')
  )

const formatMoney = (amountMinor: number, currency: string, locale: BookingLocale) =>
  (amountMinor / 100).toLocaleString(locale, { style: 'currency', currency })

const calendarSlideVariants = {
  enter: (direction: -1 | 1) => ({ x: `${direction * -120}%` }),
  center: { x: 0 },
  exit: (direction: -1 | 1) => ({ x: `${direction * 120}%` })
} satisfies Variants
