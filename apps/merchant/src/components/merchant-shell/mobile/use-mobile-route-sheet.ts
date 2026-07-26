import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent
} from 'react'
import { useLocation, useRouter } from '@tanstack/react-router'
import { hasMerchantOverlayNavigationOrigin } from '@/lib/merchant-home-route.ts'
import {
  getMobileSheetDragOffset,
  getMobileSheetSurfaceDragDistance,
  shouldBeginMobileSheetSurfaceDrag,
  shouldDismissMobileSheet,
  shouldDismissNestedMobileSheet
} from './mobile-sheet-gesture.ts'
import {
  animateMobileSheetSpring,
  getMobileSheetReleaseVelocity,
  scheduleAfterNextPaint
} from './mobile-sheet-motion.ts'
import {
  beginMobileSheetUnderlayDrag,
  finishMobileSheetUnderlayDrag,
  updateMobileSheetUnderlayDrag
} from './mobile-sheet-underlay.ts'
import { useMobileSurfaceChrome } from './use-mobile-surface-chrome.ts'
import {
  listenForMobileViewportChanges,
  mobileViewportHeight
} from './mobile-viewport.ts'

type MobileSheetState = 'entering' | 'open' | 'dragging' | 'settling' | 'closing'
type MobileTaskSheetDetent = 'compact' | 'expanded'
type MobileSheetDragMode = 'height' | 'translate'

type MobileSheetDrag = {
  mode: MobileSheetDragMode
  readonly pointerId: number
  readonly startHeight: number
  readonly startOffset: number
  readonly startY: number
  readonly startTime: number
  distance: number
}

type MobileSheetTouchDrag = {
  mode: MobileSheetDragMode
  readonly identifier: number
  readonly scrollElement: HTMLElement | null
  readonly startHeight: number
  readonly startOffset: number
  readonly startX: number
  readonly startY: number
  readonly startTime: number
  readonly startScrollTop: number
  active: boolean
  distance: number
  travelStartTime: number
}

const taskSheetBounds = () => {
  const viewportHeight = mobileViewportHeight()
  const expanded = Math.max(0, viewportHeight - 16)
  return {
    compact: Math.min(expanded, Math.max(420, Math.min(460, viewportHeight * 0.55))),
    expanded
  }
}

export function useMobileRouteSheet({
  layout = 'sheet',
  onRequestBack,
  onRequestClose
}: {
  readonly layout?: 'sheet' | 'task'
  readonly onRequestBack?: (() => void) | undefined
  readonly onRequestClose?: (() => void) | undefined
}) {
  const router = useRouter()
  const location = useLocation()
  const sheetRef = useRef<HTMLDialogElement>(null)
  const initialFocusRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const dragRef = useRef<MobileSheetDrag | null>(null)
  const touchDragRef = useRef<MobileSheetTouchDrag | null>(null)
  const sheetAnimationRef = useRef<(() => void) | null>(null)
  const clickResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasNavigatedRef = useRef(false)
  const suppressClickRef = useRef(false)
  const [sheetState, setSheetState] = useState<MobileSheetState>('entering')
  const [taskDetent, setTaskDetent] = useState<MobileTaskSheetDetent>('compact')
  const taskDetentRef = useRef<MobileTaskSheetDetent>('compact')
  useMobileSurfaceChrome(sheetState !== 'closing')

  const setTaskSheetHeight = (height: number) => {
    sheetRef.current?.style.setProperty('--merchant-task-sheet-height', `${height}px`)
  }

  const taskSheetCurrentHeight = () => {
    const sheet = sheetRef.current
    const measuredHeight = sheet?.getBoundingClientRect().height ?? 0
    if (measuredHeight > 0) return measuredHeight
    const inlineHeight = Number.parseFloat(
      sheet?.style.getPropertyValue('--merchant-task-sheet-height') ?? ''
    )
    return Number.isFinite(inlineHeight) ? inlineHeight : taskSheetBounds().compact
  }

  useEffect(
    () => () => {
      sheetAnimationRef.current?.()
      if (clickResetTimerRef.current) clearTimeout(clickResetTimerRef.current)
      finishMobileSheetUnderlayDrag()
    },
    []
  )

  useEffect(() => {
    return listenForMobileViewportChanges(
      () => {
        if (!dragRef.current && !touchDragRef.current?.active) return
        sheetAnimationRef.current?.()
        sheetAnimationRef.current = null
        dragRef.current = null
        touchDragRef.current = null
        sheetRef.current?.style.setProperty('--merchant-sheet-drag-y', '0px')
        if (layout === 'task')
          setTaskSheetHeight(taskSheetBounds()[taskDetentRef.current])
        finishMobileSheetUnderlayDrag()
        setSheetState('open')
      },
      window,
      window.visualViewport
    )
  }, [layout])

  useEffect(() => {
    const sheet = sheetRef.current
    if (!sheet) return

    const preventPageScrollDuringSheetDrag = (event: TouchEvent) => {
      const drag = touchDragRef.current
      if (!drag) return
      const touch = Array.from(event.touches).find(
        (candidate) => candidate.identifier === drag.identifier
      )
      if (!touch) return
      const shouldTakeOver =
        drag.active ||
        (layout === 'task' &&
          Math.abs(touch.clientY - drag.startY) >
            Math.abs(touch.clientX - drag.startX) * 1.15 &&
          ((taskDetentRef.current === 'compact' && touch.clientY < drag.startY - 6) ||
            (taskDetentRef.current === 'expanded' &&
              (drag.scrollElement?.scrollTop ?? 0) <= 1 &&
              touch.clientY > drag.startY + 6))) ||
        shouldBeginMobileSheetSurfaceDrag({
          deltaX: touch.clientX - drag.startX,
          deltaY: getMobileSheetSurfaceDragDistance(
            touch.clientY - drag.startY,
            drag.startScrollTop
          ),
          scrollTop: drag.scrollElement?.scrollTop ?? 0
        })
      if (shouldTakeOver && event.cancelable) event.preventDefault()
    }

    sheet.addEventListener('touchmove', preventPageScrollDuringSheetDrag, {
      passive: false
    })
    return () =>
      sheet.removeEventListener('touchmove', preventPageScrollDuringSheetDrag)
  }, [layout])

  useLayoutEffect(() => {
    const sheet = sheetRef.current
    if (!sheet) return
    const viewportHeight = mobileViewportHeight()
    if (layout === 'task') setTaskSheetHeight(taskSheetBounds().compact)
    sheet.style.setProperty('--merchant-sheet-translate-y', `${viewportHeight}px`)
    beginMobileSheetUnderlayDrag()
    updateMobileSheetUnderlayDrag(viewportHeight, viewportHeight)
    sheetAnimationRef.current = animateMobileSheetSpring({
      from: viewportHeight,
      max: viewportHeight,
      to: 0,
      onUpdate: (position) => {
        sheet.style.setProperty('--merchant-sheet-translate-y', `${position}px`)
        updateMobileSheetUnderlayDrag(position, viewportHeight)
      },
      onComplete: () => {
        sheetAnimationRef.current = null
        setSheetState('open')
      }
    })
    return () => sheetAnimationRef.current?.()
  }, [layout])

  useEffect(() => {
    const previousOverflow = document.documentElement.style.overflow
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.documentElement.style.overflow = 'hidden'
    initialFocusRef.current?.focus({ preventScroll: true })
    return () => {
      document.documentElement.style.overflow = previousOverflow
      const returnFocus = returnFocusRef.current
      queueMicrotask(() => {
        if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true })
      })
    }
  }, [])

  const navigateBack = () => {
    if (hasNavigatedRef.current) return
    hasNavigatedRef.current = true
    if (onRequestClose) {
      onRequestClose()
      return
    }
    const openedFromMerchantApp = hasMerchantOverlayNavigationOrigin(location.state)
    const appointmentDate =
      typeof (location.search as { readonly date?: unknown }).date === 'string'
        ? (location.search as { readonly date: string }).date
        : undefined

    document.documentElement.dataset.merchantNavigationSurface = 'sheet'
    setTimeout(() => {
      delete document.documentElement.dataset.merchantNavigationSurface
    }, 400)

    if (openedFromMerchantApp) {
      router.history.back()
      return
    }

    void router.navigate({
      to: '/appointments',
      search: { date: appointmentDate },
      replace: true,
      viewTransition: false
    })
  }

  const animateSheetTo = (
    destination: number,
    initialVelocity: number,
    onComplete: () => void
  ) => {
    const sheet = sheetRef.current
    if (!sheet) return
    const viewportHeight = mobileViewportHeight()
    const currentOffset = Number.parseFloat(
      sheet.style.getPropertyValue('--merchant-sheet-translate-y')
    )
    sheetAnimationRef.current?.()
    beginMobileSheetUnderlayDrag()
    sheetAnimationRef.current = animateMobileSheetSpring({
      from: Number.isFinite(currentOffset) ? currentOffset : 0,
      initialVelocity,
      max: viewportHeight,
      to: destination,
      onUpdate: (position) => {
        sheet.style.setProperty('--merchant-sheet-translate-y', `${position}px`)
        updateMobileSheetUnderlayDrag(position, viewportHeight)
      },
      onComplete: () => {
        sheetAnimationRef.current = null
        if (destination === viewportHeight) finishMobileSheetUnderlayDrag()
        onComplete()
      }
    })
  }

  const closeSheet = (initialVelocity = 0) => {
    if (sheetState === 'closing') return
    dragRef.current = null
    touchDragRef.current = null
    setSheetState('closing')
    sheetAnimationRef.current?.()
    sheetAnimationRef.current = scheduleAfterNextPaint(() => {
      sheetAnimationRef.current = null
      animateSheetTo(mobileViewportHeight(), initialVelocity, navigateBack)
    })
  }

  const settleSheet = (initialVelocity = 0) => {
    dragRef.current = null
    touchDragRef.current = null
    setSheetState('settling')
    animateSheetTo(0, initialVelocity, () => setSheetState('open'))
  }

  const animateTaskSheetTo = (
    destination: MobileTaskSheetDetent,
    initialVelocity = 0
  ) => {
    const sheet = sheetRef.current
    if (!sheet) return
    const bounds = taskSheetBounds()
    const currentHeight = Number.parseFloat(
      sheet.style.getPropertyValue('--merchant-task-sheet-height')
    )
    dragRef.current = null
    touchDragRef.current = null
    setSheetState('settling')
    sheetAnimationRef.current?.()
    sheetAnimationRef.current = animateMobileSheetSpring({
      from: Number.isFinite(currentHeight)
        ? currentHeight
        : bounds[taskDetentRef.current],
      initialVelocity,
      max: bounds.expanded,
      to: bounds[destination],
      onUpdate: setTaskSheetHeight,
      onComplete: () => {
        sheetAnimationRef.current = null
        taskDetentRef.current = destination
        setTaskDetent(destination)
        setSheetState('open')
      }
    })
  }

  const resetSuppressedClickLater = () => {
    if (clickResetTimerRef.current) clearTimeout(clickResetTimerRef.current)
    clickResetTimerRef.current = setTimeout(() => {
      suppressClickRef.current = false
    }, 350)
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0 || sheetState === 'closing') return
    event.currentTarget.setPointerCapture(event.pointerId)
    sheetAnimationRef.current?.()
    dragRef.current = {
      mode:
        layout === 'task' && taskDetentRef.current === 'expanded'
          ? 'height'
          : 'translate',
      pointerId: event.pointerId,
      startHeight: taskSheetCurrentHeight(),
      startOffset: Number.parseFloat(
        sheetRef.current?.style.getPropertyValue('--merchant-sheet-translate-y') ?? '0'
      ),
      startY: event.clientY,
      startTime: performance.now(),
      distance: 0
    }
    beginMobileSheetUnderlayDrag()
    setSheetState('dragging')
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const deltaY = event.clientY - drag.startY
    if (layout === 'task' && (drag.mode === 'height' || deltaY < 0)) {
      drag.mode = 'height'
      drag.distance = deltaY
      if (deltaY < 0) setTaskDetent('expanded')
      const bounds = taskSheetBounds()
      setTaskSheetHeight(
        Math.min(bounds.expanded, Math.max(bounds.compact, drag.startHeight - deltaY))
      )
      return
    }
    drag.distance = Math.max(0, deltaY)
    const offset = getMobileSheetDragOffset(
      drag.startOffset + drag.distance,
      mobileViewportHeight()
    )
    sheetRef.current?.style.setProperty('--merchant-sheet-translate-y', `${offset}px`)
    updateMobileSheetUnderlayDrag(offset, mobileViewportHeight())
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
    suppressClickRef.current = Math.abs(drag.distance) > 6
    resetSuppressedClickLater()
    const duration = performance.now() - drag.startTime
    const releaseVelocity = getMobileSheetReleaseVelocity(
      Math.abs(drag.distance),
      duration,
      mobileViewportHeight()
    )
    if (layout === 'task' && drag.mode === 'height') {
      const shouldExpand =
        drag.distance < -44 ||
        (taskDetentRef.current === 'compact' &&
          drag.distance < -12 &&
          releaseVelocity > 520)
      const shouldCompact =
        drag.distance > 44 ||
        (taskDetentRef.current === 'expanded' &&
          drag.distance > 12 &&
          releaseVelocity > 520)
      animateTaskSheetTo(
        shouldExpand ? 'expanded' : shouldCompact ? 'compact' : taskDetentRef.current,
        drag.distance < 0 ? releaseVelocity : -releaseVelocity
      )
      return
    }
    const dismiss = onRequestBack
      ? shouldDismissNestedMobileSheet({
          distance: drag.distance,
          viewportHeight: mobileViewportHeight()
        })
      : shouldDismissMobileSheet({
          distance: drag.distance,
          duration,
          viewportHeight: mobileViewportHeight()
        })
    if (dismiss) {
      closeSheet(releaseVelocity)
      return
    }
    settleSheet(releaseVelocity)
  }

  const handlePointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    if (layout === 'task' && dragRef.current.mode === 'height') {
      animateTaskSheetTo(taskDetentRef.current)
      return
    }
    settleSheet()
  }

  const handleTouchStart = (event: ReactTouchEvent<HTMLElement>) => {
    if (event.touches.length !== 1 || sheetState === 'closing') return
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('[data-mobile-sheet-handle="true"]')) return
    const touch = event.touches[0]
    if (!touch) return
    touchDragRef.current = {
      mode: 'translate',
      identifier: touch.identifier,
      scrollElement: target?.closest<HTMLElement>('[data-mobile-sheet-scroll]') ?? null,
      startHeight: taskSheetCurrentHeight(),
      startOffset: Number.parseFloat(
        sheetRef.current?.style.getPropertyValue('--merchant-sheet-translate-y') ?? '0'
      ),
      startX: touch.clientX,
      startY: touch.clientY,
      startTime: performance.now(),
      startScrollTop:
        target?.closest<HTMLElement>('[data-mobile-sheet-scroll]')?.scrollTop ?? 0,
      active: false,
      distance: 0,
      travelStartTime: 0
    }
  }

  const handleTouchMove = (event: ReactTouchEvent<HTMLElement>) => {
    const drag = touchDragRef.current
    if (!drag) return
    const touch = Array.from(event.touches).find(
      (candidate) => candidate.identifier === drag.identifier
    )
    if (!touch) return
    const deltaX = touch.clientX - drag.startX
    const deltaY = touch.clientY - drag.startY
    const surfaceDistance = getMobileSheetSurfaceDragDistance(
      deltaY,
      drag.startScrollTop
    )
    if (!drag.active) {
      const taskHeightGesture =
        layout === 'task' &&
        Math.abs(deltaY) > Math.abs(deltaX) * 1.15 &&
        ((taskDetentRef.current === 'compact' && deltaY < -6) ||
          (taskDetentRef.current === 'expanded' &&
            (drag.scrollElement?.scrollTop ?? 0) <= 1 &&
            deltaY > 6))
      if (
        !taskHeightGesture &&
        !shouldBeginMobileSheetSurfaceDrag({
          deltaX,
          deltaY: surfaceDistance,
          scrollTop: drag.scrollElement?.scrollTop ?? 0
        })
      ) {
        const remainsDownwardGesture = deltaY > 0 && deltaY > Math.abs(deltaX) * 1.15
        if (
          !remainsDownwardGesture &&
          Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= 8
        )
          touchDragRef.current = null
        return
      }
      drag.active = true
      drag.mode = taskHeightGesture ? 'height' : 'translate'
      if (taskHeightGesture && deltaY < 0) setTaskDetent('expanded')
      drag.travelStartTime = performance.now()
      sheetAnimationRef.current?.()
      beginMobileSheetUnderlayDrag()
      setSheetState('dragging')
    }
    drag.distance = drag.mode === 'height' ? deltaY : surfaceDistance
    if (layout === 'task' && drag.mode === 'height') {
      const bounds = taskSheetBounds()
      setTaskSheetHeight(
        Math.min(bounds.expanded, Math.max(bounds.compact, drag.startHeight - deltaY))
      )
      return
    }
    const offset = getMobileSheetDragOffset(
      drag.startOffset + drag.distance,
      mobileViewportHeight()
    )
    sheetRef.current?.style.setProperty('--merchant-sheet-translate-y', `${offset}px`)
    updateMobileSheetUnderlayDrag(offset, mobileViewportHeight())
  }

  const handleTouchEnd = (event: ReactTouchEvent<HTMLElement>) => {
    const drag = touchDragRef.current
    if (!drag) return
    const touch = Array.from(event.changedTouches).find(
      (candidate) => candidate.identifier === drag.identifier
    )
    if (!touch || !drag.active) {
      touchDragRef.current = null
      return
    }
    suppressClickRef.current = Math.abs(drag.distance) > 6
    resetSuppressedClickLater()
    const duration = performance.now() - (drag.travelStartTime || drag.startTime)
    const releaseVelocity = getMobileSheetReleaseVelocity(
      Math.abs(drag.distance),
      duration,
      mobileViewportHeight()
    )
    if (layout === 'task' && drag.mode === 'height') {
      const shouldExpand =
        drag.distance < -44 ||
        (taskDetentRef.current === 'compact' &&
          drag.distance < -12 &&
          releaseVelocity > 520)
      const shouldCompact =
        drag.distance > 44 ||
        (taskDetentRef.current === 'expanded' &&
          drag.distance > 12 &&
          releaseVelocity > 520)
      animateTaskSheetTo(
        shouldExpand ? 'expanded' : shouldCompact ? 'compact' : taskDetentRef.current,
        drag.distance < 0 ? releaseVelocity : -releaseVelocity
      )
      return
    }
    const dismiss = onRequestBack
      ? shouldDismissNestedMobileSheet({
          distance: drag.distance,
          viewportHeight: mobileViewportHeight()
        })
      : shouldDismissMobileSheet({
          distance: drag.distance,
          duration,
          viewportHeight: mobileViewportHeight()
        })
    if (dismiss) {
      closeSheet(releaseVelocity)
      return
    }
    settleSheet(releaseVelocity)
  }

  const handleTouchCancel = () => {
    if (touchDragRef.current?.active) {
      if (layout === 'task' && touchDragRef.current.mode === 'height') {
        animateTaskSheetTo(taskDetentRef.current)
        return
      }
      settleSheet()
      return
    }
    touchDragRef.current = null
  }

  const handleClickCapture = (event: ReactMouseEvent<HTMLElement>) => {
    if (!suppressClickRef.current) return
    suppressClickRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  const handleCloseClick = () => {
    if (suppressClickRef.current) return
    if (layout === 'task' && taskDetentRef.current === 'expanded') {
      animateTaskSheetTo('compact')
      return
    }
    closeSheet()
  }

  return {
    closeSheet,
    handleClickCapture,
    handleCloseClick,
    handlePointerCancel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleTouchCancel,
    handleTouchEnd,
    handleTouchMove,
    handleTouchStart,
    initialFocusRef,
    sheetRef,
    sheetState,
    taskDetent
  }
}
