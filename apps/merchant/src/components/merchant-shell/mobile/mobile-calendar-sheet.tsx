import { useRouter } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from 'react'
import {
  getMobileSheetDragOffset,
  shouldDismissMobileSheet
} from './mobile-sheet-gesture.ts'
import {
  beginMobileSheetUnderlayDrag,
  finishMobileSheetUnderlayDrag,
  updateMobileSheetUnderlayDrag
} from './mobile-sheet-underlay.ts'
import {
  animateMobileSheetSpring,
  getMobileSheetReleaseVelocity,
  scheduleAfterNextPaint
} from './mobile-sheet-motion.ts'
import { useMobileSurfaceChrome } from './use-mobile-surface-chrome.ts'

type CalendarSheetState = 'closed' | 'entering' | 'open' | 'dragging' | 'closing'

type CalendarDrag = {
  readonly pointerId: number
  readonly startOffset: number
  readonly startX: number
  readonly startY: number
  readonly startTime: number
  readonly startScrollTop: number
  active: boolean
  scrolling: boolean
  distance: number
}

export type MobileCalendarDay = {
  readonly date: string
  readonly day: number
  readonly selected: boolean
}

const calendarDate = (date: Date) => date.toISOString().slice(0, 10)
const monthAnchor = (date: string) => `${date.slice(0, 7)}-01`
const calendarDayLabel = new Intl.DateTimeFormat('en', {
  dateStyle: 'full',
  timeZone: 'UTC'
})

export function mobileCalendarMonth(visibleDate: string, selectedDate = visibleDate) {
  const anchor = new Date(`${monthAnchor(visibleDate)}T12:00:00.000Z`)
  const year = anchor.getUTCFullYear()
  const month = anchor.getUTCMonth()
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0, 12)).getUTCDate()
  const days: MobileCalendarDay[] = Array.from({ length: daysInMonth }, (_, index) => {
    const value = new Date(Date.UTC(year, month, index + 1, 12))
    const valueDate = calendarDate(value)
    return {
      date: valueDate,
      day: value.getUTCDate(),
      selected: valueDate === selectedDate
    }
  })

  const adjacentMonth = (offset: number) => {
    const value = new Date(Date.UTC(year, month + offset, 1, 12))
    return calendarDate(value)
  }

  return {
    label: new Intl.DateTimeFormat('en', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC'
    }).format(anchor),
    monthName: new Intl.DateTimeFormat('en', {
      month: 'short',
      timeZone: 'UTC'
    }).format(anchor),
    year,
    leadingBlankDays: (anchor.getUTCDay() + 6) % 7,
    previousMonth: adjacentMonth(-1),
    nextMonth: adjacentMonth(1),
    days
  }
}

export function MobileCalendarSheet({
  open,
  selectedDate,
  currentDate,
  onRequestClose
}: {
  readonly open: boolean
  readonly selectedDate: string
  readonly currentDate: string
  readonly onRequestClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const sheetAnimationRef = useRef<(() => void) | null>(null)
  const clickResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const afterCloseRef = useRef<(() => void) | null>(null)
  const dragRef = useRef<CalendarDrag | null>(null)
  const suppressClickRef = useRef(false)
  const titleId = useId()
  const router = useRouter()
  const [sheetState, setSheetState] = useState<CalendarSheetState>('closed')
  const [visibleMonth, setVisibleMonth] = useState(() => monthAnchor(selectedDate))
  useMobileSurfaceChrome(open && sheetState !== 'closing')
  const month = mobileCalendarMonth(visibleMonth, selectedDate)

  useEffect(
    () => () => {
      sheetAnimationRef.current?.()
      if (clickResetTimerRef.current) clearTimeout(clickResetTimerRef.current)
      finishMobileSheetUnderlayDrag()
    },
    []
  )

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      setVisibleMonth(monthAnchor(selectedDate))
      const panel = panelRef.current
      const viewportHeight = window.innerHeight
      panel?.style.setProperty('--merchant-calendar-drag-y', `${viewportHeight}px`)
      dialog.showModal()
      setSheetState('entering')
      beginMobileSheetUnderlayDrag()
      updateMobileSheetUnderlayDrag(viewportHeight, viewportHeight)
      if (panel) {
        sheetAnimationRef.current = animateMobileSheetSpring({
          from: viewportHeight,
          max: viewportHeight,
          to: 0,
          onUpdate: (position) => {
            panel.style.setProperty('--merchant-calendar-drag-y', `${position}px`)
            updateMobileSheetUnderlayDrag(position, viewportHeight)
          },
          onComplete: () => {
            sheetAnimationRef.current = null
            setSheetState('open')
          }
        })
      }
    }
    if (!open && dialog.open) {
      sheetAnimationRef.current?.()
      sheetAnimationRef.current = null
      finishMobileSheetUnderlayDrag()
      dialog.close()
      setSheetState('closed')
    }
  }, [open, selectedDate])

  const finishClose = () => {
    dialogRef.current?.close()
    setSheetState('closed')
    onRequestClose()
    const afterClose = afterCloseRef.current
    afterCloseRef.current = null
    afterClose?.()
  }

  const animateCalendarTo = (
    destination: number,
    initialVelocity: number,
    onComplete: () => void
  ) => {
    const panel = panelRef.current
    if (!panel) return
    const viewportHeight = window.innerHeight
    const currentOffset = Number.parseFloat(
      panel.style.getPropertyValue('--merchant-calendar-drag-y')
    )
    sheetAnimationRef.current?.()
    beginMobileSheetUnderlayDrag()
    sheetAnimationRef.current = animateMobileSheetSpring({
      from: Number.isFinite(currentOffset) ? currentOffset : 0,
      initialVelocity,
      max: viewportHeight,
      to: destination,
      onUpdate: (position) => {
        panel.style.setProperty('--merchant-calendar-drag-y', `${position}px`)
        updateMobileSheetUnderlayDrag(position, viewportHeight)
      },
      onComplete: () => {
        sheetAnimationRef.current = null
        if (destination === viewportHeight) finishMobileSheetUnderlayDrag()
        onComplete()
      }
    })
  }

  const requestClose = (initialVelocity = 0) => {
    if (sheetState === 'closing' || sheetState === 'closed') return
    dragRef.current = null
    setSheetState('closing')
    sheetAnimationRef.current?.()
    sheetAnimationRef.current = scheduleAfterNextPaint(() => {
      sheetAnimationRef.current = null
      animateCalendarTo(window.innerHeight, initialVelocity, finishClose)
    })
  }

  const chooseDate = (date: string) => {
    if (suppressClickRef.current) return
    afterCloseRef.current = () => {
      void router.navigate({
        to: '/appointments',
        search: { date },
        replace: true,
        viewTransition: false
      })
    }
    requestClose()
  }

  const changeMonth = (date: string) => {
    if (!suppressClickRef.current) setVisibleMonth(date)
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!event.isPrimary || event.button !== 0 || sheetState === 'closing') return
    dragRef.current = {
      pointerId: event.pointerId,
      startOffset: Number.parseFloat(
        panelRef.current?.style.getPropertyValue('--merchant-calendar-drag-y') ?? '0'
      ),
      startX: event.clientX,
      startY: event.clientY,
      startTime: performance.now(),
      startScrollTop: event.currentTarget.scrollTop,
      active: false,
      scrolling: false,
      distance: 0
    }
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const deltaX = event.clientX - drag.startX
    const deltaY = event.clientY - drag.startY
    if (drag.scrolling) {
      event.currentTarget.scrollTop = Math.max(0, drag.startScrollTop - deltaY)
      return
    }
    if (!drag.active) {
      if (Math.abs(deltaY) < 8 || Math.abs(deltaY) <= Math.abs(deltaX)) return
      if (deltaY < 0 || drag.startScrollTop > 0) {
        drag.scrolling = true
        event.currentTarget.setPointerCapture(event.pointerId)
        event.currentTarget.scrollTop = Math.max(0, drag.startScrollTop - deltaY)
        return
      }
      drag.active = true
      sheetAnimationRef.current?.()
      event.currentTarget.setPointerCapture(event.pointerId)
      beginMobileSheetUnderlayDrag()
      setSheetState('dragging')
    }
    drag.distance = Math.max(0, deltaY)
    const offset = getMobileSheetDragOffset(
      drag.startOffset + drag.distance,
      window.innerHeight
    )
    event.currentTarget.style.setProperty('--merchant-calendar-drag-y', `${offset}px`)
    updateMobileSheetUnderlayDrag(offset, window.innerHeight)
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    if (!drag.active && !drag.scrolling) return
    suppressClickRef.current = true
    if (clickResetTimerRef.current) clearTimeout(clickResetTimerRef.current)
    clickResetTimerRef.current = setTimeout(() => {
      suppressClickRef.current = false
    }, 350)
    event.preventDefault()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (drag.scrolling) return
    const duration = performance.now() - drag.startTime
    const releaseVelocity = getMobileSheetReleaseVelocity(
      drag.distance,
      duration,
      window.innerHeight
    )
    if (
      shouldDismissMobileSheet({
        distance: drag.distance,
        duration,
        viewportHeight: window.innerHeight
      })
    ) {
      requestClose(releaseVelocity)
      return
    }
    setSheetState('open')
    animateCalendarTo(0, releaseVelocity, () => setSheetState('open'))
  }

  const handlePointerCancel = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    setSheetState('open')
    animateCalendarTo(0, 0, () => setSheetState('open'))
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      data-calendar-sheet-state={sheetState}
      className="merchant-more-dialog merchant-calendar-dialog"
      onCancel={(event) => {
        event.preventDefault()
        requestClose()
      }}
    >
      <button
        type="button"
        aria-label="Close calendar"
        className="merchant-more-dismiss"
        onClick={() => requestClose()}
      />
      <section
        ref={panelRef}
        className="merchant-more-panel merchant-calendar-panel merchant-floating-sheet-panel touch-pan-x"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <header className="flex items-center justify-between gap-2 px-4 pt-5 pb-3">
          <h2
            id={titleId}
            className="whitespace-nowrap text-xl leading-7 font-semibold"
          >
            {month.monthName}{' '}
            <span className="text-muted-foreground">{month.year}</span>
          </h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Previous month"
              className="grid size-10 place-items-center rounded-full text-muted-foreground active:bg-muted"
              onClick={() => changeMonth(month.previousMonth)}
            >
              <ChevronLeft aria-hidden className="size-5" strokeWidth={2} />
            </button>
            <button
              type="button"
              className="min-h-10 rounded-full px-2 text-sm font-semibold text-muted-foreground active:bg-muted"
              onClick={() => chooseDate(currentDate)}
            >
              Today
            </button>
            <button
              type="button"
              aria-label="Next month"
              className="grid size-10 place-items-center rounded-full text-muted-foreground active:bg-muted"
              onClick={() => changeMonth(month.nextMonth)}
            >
              <ChevronRight aria-hidden className="size-5" strokeWidth={2} />
            </button>
          </div>
        </header>
        <div className="grid grid-cols-7 px-4 text-center text-xs font-semibold text-muted-foreground uppercase">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((weekday, index) => (
            <span key={`${weekday}-${index}`} className="py-3">
              {weekday}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-1 px-4 pb-6">
          {Array.from({ length: month.leadingBlankDays }, (_, index) => (
            <span key={`blank-${index}`} aria-hidden className="size-10" />
          ))}
          {month.days.map((day) => (
            <button
              key={day.date}
              type="button"
              aria-label={calendarDayLabel.format(
                new Date(`${day.date}T12:00:00.000Z`)
              )}
              aria-pressed={day.selected}
              className={`mx-auto grid size-10 place-items-center rounded-full text-base font-medium tabular-nums active:scale-95 ${day.selected ? 'bg-primary text-primary-foreground' : 'text-foreground active:bg-muted'}`}
              onClick={() => chooseDate(day.date)}
            >
              {day.day}
            </button>
          ))}
        </div>
      </section>
    </dialog>
  )
}
