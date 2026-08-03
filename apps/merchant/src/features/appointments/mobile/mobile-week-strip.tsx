import { Link } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { mobileWeek } from './mobile-appointments-model.ts'
import {
  appointmentWeekSettleDuration,
  shouldCommitAppointmentWeekSwipe
} from './mobile-week-strip-model.ts'
import {
  appointmentWeekDirection,
  appointmentWeekTarget,
  type AppointmentWeekDirection
} from './week-navigation.ts'

const WEEK_TRANSITION_MS = 240

type WeekDrag = {
  readonly pointerId: number
  readonly startTime: number
  readonly startX: number
  readonly startY: number
  readonly width: number
  active: boolean
  lastX: number
}

type ExternalWeekTransition = {
  readonly direction: AppointmentWeekDirection
  readonly fromDate: string
  readonly toDate: string
}

export function MobileWeekStrip({
  selectedDate,
  currentDate,
  onSelectDate,
  spacing = 'mobile'
}: {
  readonly selectedDate: string
  readonly currentDate: string
  readonly onSelectDate: (date: string) => void
  readonly spacing?: 'mobile' | 'desktop'
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<WeekDrag | null>(null)
  const navigationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingDateRef = useRef<string | null>(null)
  const suppressClickRef = useRef(false)
  const [renderedDate, setRenderedDate] = useState(selectedDate)
  const [dragOffset, setDragOffset] = useState(0)
  const [settleDuration, setSettleDuration] = useState(WEEK_TRANSITION_MS)
  const [settlingDirection, setSettlingDirection] =
    useState<AppointmentWeekDirection | null>(null)
  const [externalTransition, setExternalTransition] =
    useState<ExternalWeekTransition | null>(null)
  const [externalTransitionStarted, setExternalTransitionStarted] = useState(false)

  useEffect(
    () => () => {
      if (navigationTimerRef.current) clearTimeout(navigationTimerRef.current)
    },
    []
  )

  if (pendingDateRef.current) {
    if (selectedDate === pendingDateRef.current && !settlingDirection) {
      if (selectedDate !== renderedDate) setRenderedDate(selectedDate)
    }
  } else if (selectedDate !== renderedDate && !externalTransition) {
    const direction = appointmentWeekDirection(renderedDate, selectedDate)
    if (!direction) {
      setRenderedDate(selectedDate)
    } else {
      setExternalTransition({
        direction,
        fromDate: renderedDate,
        toDate: selectedDate
      })
      setExternalTransitionStarted(false)
    }
  }

  useEffect(() => {
    if (pendingDateRef.current === selectedDate && !settlingDirection)
      pendingDateRef.current = null
  }, [selectedDate, settlingDirection])

  useEffect(() => {
    if (!externalTransition || externalTransitionStarted) return
    const frame = requestAnimationFrame(() => setExternalTransitionStarted(true))
    return () => cancelAnimationFrame(frame)
  }, [externalTransition, externalTransitionStarted])

  const moveWeek = (
    direction: AppointmentWeekDirection,
    duration = WEEK_TRANSITION_MS
  ) => {
    if (settlingDirection || externalTransition) return
    const width = viewportRef.current?.clientWidth || 320
    const target = appointmentWeekTarget(renderedDate, direction)
    pendingDateRef.current = target
    setSettleDuration(duration)
    setSettlingDirection(direction)
    setDragOffset(direction === 'next' ? -width : width)
    onSelectDate(target)
    if (navigationTimerRef.current) clearTimeout(navigationTimerRef.current)
    navigationTimerRef.current = setTimeout(() => {
      setRenderedDate(target)
      setDragOffset(0)
      setSettlingDirection(null)
    }, duration)
  }

  const settleCurrentWeek = () => {
    setSettlingDirection(null)
    setDragOffset(0)
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0 || externalTransition) return
    const width = event.currentTarget.clientWidth || 320
    dragRef.current = {
      pointerId: event.pointerId,
      startTime: performance.now(),
      startX: event.clientX,
      startY: event.clientY,
      width,
      active: false,
      lastX: event.clientX
    }
    setSettlingDirection(null)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const deltaX = event.clientX - drag.startX
    const deltaY = event.clientY - drag.startY
    drag.lastX = event.clientX
    if (!drag.active) {
      if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) return
      if (Math.abs(deltaX) <= Math.abs(deltaY) * 1.15) {
        dragRef.current = null
        return
      }
      drag.active = true
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    event.preventDefault()
    setDragOffset(Math.max(-drag.width, Math.min(drag.width, deltaX)))
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    if (!drag.active) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    suppressClickRef.current = true
    queueMicrotask(() => {
      suppressClickRef.current = false
    })
    const duration = performance.now() - drag.startTime
    const distance = drag.lastX - drag.startX
    if (
      shouldCommitAppointmentWeekSwipe({
        distance,
        duration,
        width: drag.width
      })
    ) {
      moveWeek(
        distance < 0 ? 'next' : 'previous',
        appointmentWeekSettleDuration({ distance, width: drag.width })
      )
      return
    }
    setSettlingDirection('next')
    setDragOffset(0)
    navigationTimerRef.current = setTimeout(settleCurrentWeek, WEEK_TRANSITION_MS)
  }

  const handlePointerCancel = () => {
    dragRef.current = null
    setSettlingDirection('next')
    setDragOffset(0)
    navigationTimerRef.current = setTimeout(settleCurrentWeek, WEEK_TRANSITION_MS)
  }

  const handleClickCapture = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!suppressClickRef.current) return
    event.preventDefault()
    event.stopPropagation()
  }

  const finishExternalTransition = () => {
    if (!externalTransition) return
    setRenderedDate(externalTransition.toDate)
    setExternalTransition(null)
    setExternalTransitionStarted(false)
  }

  const trackTransition = `transform ${settleDuration}ms cubic-bezier(0.22, 1, 0.36, 1)`
  const externalTrackTransition = `transform ${WEEK_TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`
  const desktop = spacing === 'desktop'

  return (
    <nav
      aria-label="Appointment week"
      data-week-strip-spacing={spacing}
      data-week-strip-state={
        externalTransition
          ? 'changing'
          : dragRef.current?.active
            ? 'dragging'
            : settlingDirection
              ? 'settling'
              : 'idle'
      }
      className={`${desktop ? 'mt-4' : 'mt-3'} relative`}
    >
      {desktop ? (
        <button
          type="button"
          aria-label="Previous week"
          className="absolute top-1/2 left-0 z-20 grid size-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-card/70 hover:text-foreground active:scale-95"
          onClick={() => moveWeek('previous')}
        >
          <ChevronLeft aria-hidden className="size-5" />
        </button>
      ) : null}
      <div
        ref={viewportRef}
        data-week-strip-viewport="true"
        className={`${desktop ? 'mx-8' : ''} overflow-hidden touch-pan-y select-none`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        {externalTransition ? (
          <ExternalWeekTrack
            transition={externalTransition}
            started={externalTransitionStarted}
            currentDate={currentDate}
            trackTransition={externalTrackTransition}
            onClickCapture={handleClickCapture}
            onTransitionEnd={finishExternalTransition}
          />
        ) : (
          <div
            data-week-strip-track="true"
            className="flex w-[300%]"
            style={
              {
                transform: `translate3d(calc(-33.333333% + ${dragOffset}px), 0, 0)`,
                transition: settlingDirection ? trackTransition : 'none'
              } satisfies CSSProperties
            }
          >
            <WeekPanel
              selectedDate={appointmentWeekTarget(renderedDate, 'previous')}
              currentDate={currentDate}
              interactive={false}
              onClickCapture={handleClickCapture}
            />
            <WeekPanel
              selectedDate={renderedDate}
              currentDate={currentDate}
              interactive
              onClickCapture={handleClickCapture}
            />
            <WeekPanel
              selectedDate={appointmentWeekTarget(renderedDate, 'next')}
              currentDate={currentDate}
              interactive={false}
              onClickCapture={handleClickCapture}
            />
          </div>
        )}
      </div>
      {desktop ? (
        <button
          type="button"
          aria-label="Next week"
          className="absolute top-1/2 right-0 z-20 grid size-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-card/70 hover:text-foreground active:scale-95"
          onClick={() => moveWeek('next')}
        >
          <ChevronRight aria-hidden className="size-5" />
        </button>
      ) : null}
    </nav>
  )
}

function ExternalWeekTrack({
  transition,
  started,
  currentDate,
  trackTransition,
  onClickCapture,
  onTransitionEnd
}: {
  readonly transition: ExternalWeekTransition
  readonly started: boolean
  readonly currentDate: string
  readonly trackTransition: string
  readonly onClickCapture: (event: ReactMouseEvent<HTMLAnchorElement>) => void
  readonly onTransitionEnd: () => void
}) {
  const next = transition.direction === 'next'
  return (
    <div
      data-week-strip-track="true"
      className="flex w-[200%]"
      style={{
        transform: next
          ? `translate3d(${started ? '-50%' : '0%'}, 0, 0)`
          : `translate3d(${started ? '0%' : '-50%'}, 0, 0)`,
        transition: started ? trackTransition : 'none'
      }}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && event.propertyName === 'transform')
          onTransitionEnd()
      }}
    >
      <WeekPanel
        selectedDate={next ? transition.fromDate : transition.toDate}
        currentDate={currentDate}
        width="half"
        interactive={!next}
        onClickCapture={onClickCapture}
      />
      <WeekPanel
        selectedDate={next ? transition.toDate : transition.fromDate}
        currentDate={currentDate}
        width="half"
        interactive={next}
        onClickCapture={onClickCapture}
      />
    </div>
  )
}

function WeekPanel({
  selectedDate,
  currentDate,
  interactive,
  onClickCapture,
  width = 'third'
}: {
  readonly selectedDate: string
  readonly currentDate: string
  readonly interactive: boolean
  readonly onClickCapture: (event: ReactMouseEvent<HTMLAnchorElement>) => void
  readonly width?: 'third' | 'half'
}) {
  return (
    <div
      data-week-panel={selectedDate}
      aria-hidden={interactive ? undefined : true}
      className={`${width === 'third' ? 'w-1/3' : 'w-1/2'} grid shrink-0 grid-cols-7 gap-1`}
    >
      {mobileWeek(selectedDate, currentDate).map((day) => (
        <Link
          key={day.date}
          to="/appointments"
          search={{ date: day.date }}
          viewTransition={false}
          onClickCapture={onClickCapture}
          tabIndex={interactive ? undefined : -1}
          aria-current={day.selected ? 'date' : undefined}
          className={`relative grid min-h-15 place-content-center rounded-xl pt-3 pb-2 text-center transition-colors ${day.selected ? 'scale-[1.05] bg-card text-foreground' : 'text-muted-foreground hover:bg-card/60'}`}
        >
          {day.current ? (
            <span
              data-current-day-marker="true"
              className="absolute top-1.5 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-primary"
              aria-hidden
            />
          ) : null}
          <span className="text-xl font-bold tabular-nums">{day.day}</span>
          <span
            className={`mt-1 text-[0.65rem] font-bold tracking-[0.08em] uppercase ${day.selected ? 'text-foreground' : ''}`}
          >
            {day.weekday}
          </span>
        </Link>
      ))}
    </div>
  )
}
