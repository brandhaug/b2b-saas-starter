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

type MobileSheetDrag = {
  readonly pointerId: number
  readonly startOffset: number
  readonly startY: number
  readonly startTime: number
  distance: number
}

type MobileSheetTouchDrag = {
  readonly identifier: number
  readonly scrollElement: HTMLElement | null
  readonly startOffset: number
  readonly startX: number
  readonly startY: number
  readonly startTime: number
  readonly startScrollTop: number
  active: boolean
  distance: number
  travelStartTime: number
}

export function useMobileRouteSheet({
  onRequestBack,
  onRequestClose
}: {
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
  useMobileSurfaceChrome(sheetState !== 'closing')

  useEffect(
    () => () => {
      sheetAnimationRef.current?.()
      if (clickResetTimerRef.current) clearTimeout(clickResetTimerRef.current)
      finishMobileSheetUnderlayDrag()
    },
    []
  )

  useEffect(
    () =>
      listenForMobileViewportChanges(
        () => {
          if (!dragRef.current && !touchDragRef.current?.active) return
          sheetAnimationRef.current?.()
          sheetAnimationRef.current = null
          dragRef.current = null
          touchDragRef.current = null
          sheetRef.current?.style.setProperty('--merchant-sheet-drag-y', '0px')
          finishMobileSheetUnderlayDrag()
          setSheetState('open')
        },
        window,
        window.visualViewport
      ),
    []
  )

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
  }, [])

  useLayoutEffect(() => {
    const sheet = sheetRef.current
    if (!sheet) return
    const viewportHeight = mobileViewportHeight()
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
  }, [])

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
      pointerId: event.pointerId,
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
    drag.distance = Math.max(0, event.clientY - drag.startY)
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
    suppressClickRef.current = drag.distance > 6
    resetSuppressedClickLater()
    const duration = performance.now() - drag.startTime
    const releaseVelocity = getMobileSheetReleaseVelocity(
      drag.distance,
      duration,
      mobileViewportHeight()
    )
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
    settleSheet()
  }

  const handleTouchStart = (event: ReactTouchEvent<HTMLElement>) => {
    if (event.touches.length !== 1 || sheetState === 'closing') return
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('[data-mobile-sheet-handle="true"]')) return
    const touch = event.touches[0]
    if (!touch) return
    touchDragRef.current = {
      identifier: touch.identifier,
      scrollElement: target?.closest<HTMLElement>('[data-mobile-sheet-scroll]') ?? null,
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
      if (
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
      drag.travelStartTime = performance.now()
      sheetAnimationRef.current?.()
      beginMobileSheetUnderlayDrag()
      setSheetState('dragging')
    }
    drag.distance = surfaceDistance
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
    suppressClickRef.current = drag.distance > 6
    resetSuppressedClickLater()
    const duration = performance.now() - (drag.travelStartTime || drag.startTime)
    const releaseVelocity = getMobileSheetReleaseVelocity(
      drag.distance,
      duration,
      mobileViewportHeight()
    )
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
    if (!suppressClickRef.current) closeSheet()
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
    sheetState
  }
}
