import { useRouter } from '@tanstack/react-router'
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
import { mobileCalendarMonth, monthAnchor } from './mobile-calendar-model.ts'
import { MobileCalendarSheetView } from './mobile-calendar-sheet-view.tsx'
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
  if (!open) return null
  return (
    <MobileCalendarSheetDialog
      key={selectedDate}
      selectedDate={selectedDate}
      currentDate={currentDate}
      onRequestClose={onRequestClose}
    />
  )
}

function MobileCalendarSheetDialog({
  selectedDate,
  currentDate,
  onRequestClose
}: {
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
  useMobileSurfaceChrome(sheetState !== 'closing')
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
    const panel = panelRef.current
    if (!dialog || !panel) return
    const viewportHeight = window.innerHeight
    panel.style.setProperty('--merchant-calendar-drag-y', `${viewportHeight}px`)
    dialog.showModal()
    setSheetState('entering')
    beginMobileSheetUnderlayDrag()
    updateMobileSheetUnderlayDrag(viewportHeight, viewportHeight)
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
    return () => {
      sheetAnimationRef.current?.()
      sheetAnimationRef.current = null
    }
  }, [])

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
    <MobileCalendarSheetView
      dialogRef={dialogRef}
      panelRef={panelRef}
      titleId={titleId}
      sheetState={sheetState}
      month={month}
      currentDate={currentDate}
      requestClose={requestClose}
      chooseDate={chooseDate}
      changeMonth={changeMonth}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    />
  )
}
