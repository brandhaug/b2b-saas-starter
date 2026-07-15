import * as stylex from '@stylexjs/stylex'
import { AnimatePresence, LazyMotion, domAnimation, m } from 'motion/react'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
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
import { calendarSlideVariants } from '../presentation/booking-calendar-motion.ts'

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
  premiumPalette = null,
  embedded = false,
  showOrderBar = true
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
  readonly embedded?: boolean
  readonly showOrderBar?: boolean
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
      weekdayNarrow: new Intl.DateTimeFormat(locale, {
        timeZone: availability.timezone,
        weekday: 'narrow'
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
    () => calendarDays(scheduleSlots, formatters.date, availability.range),
    [scheduleSlots, formatters.date, availability.range]
  )
  const calendarRangeDaySet = useMemo(() => new Set(days), [days])
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
    <BookingSchedulingFrame
      embedded={embedded}
      busy={busy}
      busyLabel={message('feedback.loading')}
      premiumPalette={premiumPalette}
    >
      {!embedded ? (
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
      ) : null}
      <main
        data-testid="container:scrollable"
        {...stylex.props(styles.main, embedded && styles.embeddedSchedulingMain)}
      >
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
              {message('scheduling.empty_title').replace(
                '{days}',
                String(availability.range.days)
              )}
            </h2>
            <p {...stylex.props(styles.emptyCopy)}>
              {message('scheduling.empty_copy')}
            </p>
          </div>
        ) : (
          <>
            <div {...stylex.props(styles.scheduleCalendar)}>
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
                      data-testid="btn:today"
                      data-calendar-control-variant="outlined"
                      onClick={() => {
                        setChosenDate(
                          calendarRangeDaySet.has(today) ? today : (days[0] ?? null)
                        )
                        setCalendarExpanded(false)
                      }}
                      {...stylex.props(styles.calendarTextControl)}
                    >
                      {message('scheduling.today')}
                    </button>
                    <div {...stylex.props(styles.calendarArrowControls)}>
                      <button
                        type="button"
                        data-testid="btn:prevMonth"
                        aria-label={message('scheduling.previous_month')}
                        disabled={displayMonth <= firstMonth}
                        onClick={() => {
                          setMonthDirection(-1)
                          setDisplayMonth(addMonth(displayMonth, -1))
                        }}
                        {...stylex.props(styles.calendarArrowControl)}
                      >
                        <CalendarMonthArrow />
                      </button>
                      <button
                        type="button"
                        data-testid="btn:nextMonth"
                        aria-label={message('scheduling.next_month')}
                        disabled={displayMonth >= lastMonth}
                        onClick={() => {
                          setMonthDirection(1)
                          setDisplayMonth(addMonth(displayMonth, 1))
                        }}
                        {...stylex.props(styles.calendarArrowControl)}
                      >
                        <CalendarMonthArrow right />
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              <LazyMotion features={domAnimation} strict>
                <div {...stylex.props(styles.calendarTransitionContainer)}>
                  <div {...stylex.props(styles.lineCalendarContainer)}>
                    <AnimatePresence initial={false}>
                      {!calendarExpanded ? (
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
                      ) : null}
                    </AnimatePresence>
                  </div>
                  <AnimatePresence initial={false}>
                    {calendarExpanded ? (
                      <LegacyCalendarMonth
                        key="calendar"
                        displayMonth={displayMonth}
                        direction={monthDirection}
                        activeDate={activeDate}
                        today={today}
                        calendarRangeDaySet={calendarRangeDaySet}
                        availableDaySet={availableDaySet}
                        longDate={formatters.longDate}
                        weekday={formatters.weekdayNarrow}
                        month={formatters.month}
                        onChoose={(date) => {
                          setChosenDate(date)
                          setCalendarExpanded(false)
                        }}
                      />
                    ) : null}
                  </AnimatePresence>
                </div>
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
                    const selected = availability.hold?.quote.startsAt === slot.startsAt
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
          {showOrderBar &&
          availability.slots.length > 0 &&
          availability.hold &&
          onCheckout ? (
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
    </BookingSchedulingFrame>
  )
}

function BookingSchedulingFrame({
  embedded,
  busy,
  busyLabel,
  premiumPalette,
  children
}: {
  readonly embedded: boolean
  readonly busy: boolean
  readonly busyLabel: string
  readonly premiumPalette: BookingPremiumPalette | null
  readonly children: ReactNode
}) {
  if (embedded) return children
  return (
    <BookingPremiumThemeBoundary palette={premiumPalette}>
      <BookingWidgetShell busy={busy} busyLabel={busyLabel}>
        {children}
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
  range: BookingAvailability['range']
) => {
  if (!slots[0]) return []
  const firstSlot = formatter.format(new Date(slots[0].startsAt))
  const rangeStart = formatter.format(new Date(range.from))
  const first = firstSlot < rangeStart ? firstSlot : rangeStart
  const lastSlot = formatter.format(new Date(slots.at(-1)!.startsAt))
  const rangeEnd = addDay(rangeStart, range.days - 1)
  const last = lastSlot > rangeEnd ? lastSlot : rangeEnd
  const length =
    Math.round(
      (asLocalNoon(last).getTime() - asLocalNoon(first).getTime()) / 86_400_000
    ) + 1
  return Array.from({ length }, (_, index) => addDay(first, index))
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

function LegacyCalendarMonth({
  displayMonth,
  direction,
  activeDate,
  today,
  calendarRangeDaySet,
  availableDaySet,
  longDate,
  weekday,
  month,
  onChoose
}: {
  readonly displayMonth: string
  readonly direction: -1 | 1
  readonly activeDate: string | null
  readonly today: string
  readonly calendarRangeDaySet: ReadonlySet<string>
  readonly availableDaySet: ReadonlySet<string>
  readonly longDate: Intl.DateTimeFormat
  readonly weekday: Intl.DateTimeFormat
  readonly month: Intl.DateTimeFormat
  readonly onChoose: (date: string) => void
}) {
  const [renderedMonth, setRenderedMonth] = useState(displayMonth)
  const monthBody = useRef<HTMLDivElement | null>(null)
  const monthDays = useMemo(
    () => calendarMonthDays(`${renderedMonth}-01`),
    [renderedMonth]
  )
  const fallbackHeight = (monthDays.length / 7) * 40
  const [bodyHeight, setBodyHeight] = useState(fallbackHeight)

  useEffect(() => {
    if (displayMonth === renderedMonth) return
    const timer = window.setTimeout(() => setRenderedMonth(displayMonth), 150)
    return () => window.clearTimeout(timer)
  }, [displayMonth, renderedMonth])

  useLayoutEffect(() => {
    const measured = monthBody.current?.scrollHeight ?? 0
    setBodyHeight(measured || fallbackHeight)
  }, [fallbackHeight, renderedMonth])

  return (
    <m.div
      layout
      data-testid="calendarMonth"
      data-calendar-contract="legacy-calendar-month"
      data-calendar-grid-alignment="full-width"
      initial={{
        y: -50,
        height: 0,
        opacity: 0,
        overflow: 'hidden',
        position: 'relative',
        top: -50
      }}
      animate={{
        y: 0,
        height: 'auto',
        opacity: [0, 0, 1],
        overflow: 'visible',
        position: 'relative',
        top: [-50, -50, 0]
      }}
      exit={{
        y: -50,
        height: 0,
        opacity: [1, 0, 0],
        overflow: 'visible',
        top: 0
      }}
      transition={{ duration: 0.3, ease: 'easeInOut' }}
      {...stylex.props(styles.expandedCalendar)}
    >
      <div data-calendar-layer="header" {...stylex.props(styles.weekdayGrid)}>
        {calendarWeekdays(weekday).map((label, index) => (
          <span key={`${label}-${index}`} {...stylex.props(styles.monthWeekday)}>
            {label}
          </span>
        ))}
      </div>
      <div
        data-calendar-layer="body-positioner"
        style={{ minHeight: bodyHeight }}
        {...stylex.props(styles.monthSlideViewport)}
      >
        <AnimatePresence initial={false} custom={direction} mode="sync">
          <m.div
            key={renderedMonth}
            custom={direction}
            variants={calendarSlideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.6 }}
            {...stylex.props(styles.monthSlide)}
          >
            <div
              ref={monthBody}
              data-calendar-layer="body"
              {...stylex.props(styles.monthGrid)}
            >
              {monthDays.map((date) => {
                const selected = date === activeDate
                const outsideMonth = date.slice(0, 7) !== renderedMonth
                if (outsideMonth) {
                  return (
                    <span
                      key={date}
                      aria-hidden="true"
                      data-calendar-cell
                      data-calendar-day-state="outside-month"
                      {...stylex.props(styles.monthDayCell)}
                    />
                  )
                }
                const outsideRange = !calendarRangeDaySet.has(date)
                const available = availableDaySet.has(date)
                const state = selected
                  ? 'selected'
                  : outsideRange
                    ? 'outside-range'
                    : available
                      ? 'available'
                      : 'day-off'
                const enabled = !outsideRange && (available || date === today)
                return (
                  <button
                    key={date}
                    type="button"
                    disabled={!enabled}
                    aria-label={longDate.format(asLocalNoon(date))}
                    aria-pressed={selected}
                    data-calendar-cell
                    data-calendar-day-state={state}
                    onClick={() => {
                      if (selected && date !== today) return
                      onChoose(date)
                    }}
                    {...stylex.props(styles.monthDayCell, styles.dateButton)}
                  >
                    <span
                      {...stylex.props(
                        styles.monthDay,
                        outsideRange && styles.outsideMonthDay,
                        !outsideRange && !available && styles.monthDayOff,
                        !outsideRange && available && styles.availableMonthDay,
                        selected && styles.selectedMonthDay
                      )}
                    >
                      <span
                        data-calendar-day-border="inner"
                        {...stylex.props(
                          styles.monthDayBorder,
                          selected && styles.selectedMonthDayBorder
                        )}
                      >
                        {date.slice(-2).replace(/^0/, '')}
                      </span>
                      {date === today ? (
                        <span
                          aria-hidden="true"
                          {...stylex.props(
                            styles.monthTodayDot,
                            !available && !outsideRange && styles.monthDayOffTodayDot,
                            selected && styles.selectedMonthTodayDot
                          )}
                        />
                      ) : null}
                    </span>
                  </button>
                )
              })}
            </div>
          </m.div>
        </AnimatePresence>
      </div>
      <div
        aria-hidden="true"
        data-calendar-layer="month-names"
        {...stylex.props(styles.monthNamesContainer)}
      >
        <p {...stylex.props(styles.expandedMonthName)}>
          {month.format(asLocalNoon(`${renderedMonth}-01`)).replace(/\s+\d{4}$/, '')}
        </p>
      </div>
    </m.div>
  )
}

function CalendarMonthArrow({ right = false }: { readonly right?: boolean }) {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 26 26"
      fill="none"
      aria-hidden="true"
      {...stylex.props(styles.calendarArrowIcon, right && styles.rightCalendarArrow)}
    >
      <rect x="0.5" y="0.5" width="25" height="25" rx="12.5" stroke="#dadadc" />
      <path
        d="M8.89 12.77c0 .146.053.275.165.386l4.646 4.541c.1.106.229.159.381.159.305 0 .54-.229.54-.534a.55.55 0 0 0-.16-.38l-4.265-4.172 4.266-4.172a.562.562 0 0 0 .158-.381.526.526 0 0 0-.539-.533.521.521 0 0 0-.38.152l-4.647 4.547a.519.519 0 0 0-.164.387Z"
        fill="currentColor"
      />
    </svg>
  )
}

const calendarMonthDays = (date: string) => {
  const month = date.slice(0, 7)
  const first = `${month}-01`
  const startWeekday = asLocalNoon(first).getUTCDay()
  const firstCell = addDay(first, -startWeekday)
  const monthStart = asLocalNoon(first)
  const nextMonth = new Date(monthStart)
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1)
  const daysInMonth = Math.round(
    (nextMonth.getTime() - monthStart.getTime()) / 86_400_000
  )
  const cellCount = Math.ceil((startWeekday + daysInMonth) / 7) * 7
  return Array.from({ length: cellCount }, (_, index) => addDay(firstCell, index))
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
