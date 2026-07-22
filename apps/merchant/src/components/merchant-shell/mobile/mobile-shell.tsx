import { useLocation, useRouter } from '@tanstack/react-router'
import {
  useEffect,
  useRef,
  useState,
  type AnimationEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type TouchEvent as ReactTouchEvent,
  type TransitionEvent
} from 'react'
import type { MerchantDestination, MerchantShellSection } from '../navigation.tsx'
import { useMobileHomeUnderlay } from '../merchant-presentation.tsx'
import { MobileHomeActions } from './mobile-home-actions.tsx'
import {
  getMobileSheetDragOffset,
  hasMobileSheetNavigationOrigin,
  shouldBeginMobileSheetSurfaceDrag,
  shouldDismissMobileSheet
} from './mobile-sheet-gesture.ts'
import {
  listenForMobileViewportChanges,
  mobileViewportHeight
} from './mobile-viewport.ts'

type MobileSheetState = 'entering' | 'open' | 'dragging' | 'settling' | 'closing'

type MobileSheetDrag = {
  readonly pointerId: number
  readonly startY: number
  readonly startTime: number
  distance: number
}

type MobileSheetTouchDrag = {
  readonly identifier: number
  readonly scrollElement: HTMLElement | null
  readonly startX: number
  readonly startY: number
  readonly startTime: number
  active: boolean
  distance: number
}

type MobileShellProps = {
  readonly section: MerchantShellSection
  readonly destinations: readonly MerchantDestination[]
  readonly children: ReactNode
} & (
  | {
      readonly layout: 'sheet' | 'task'
      readonly title: string
      readonly description: string
    }
  | {
      readonly layout: 'home'
      readonly date?: string | undefined
    }
)

export function MobileShell(props: MobileShellProps) {
  const { section, destinations, layout, children } = props
  const router = useRouter()
  const location = useLocation()
  const mobileHomeUnderlay = useMobileHomeUnderlay()
  const homeUnderlay = mobileHomeUnderlay?.content.current ?? null
  const homeDate = mobileHomeUnderlay?.date.current
  const homeUnderlayOrigin = mobileHomeUnderlay?.origin.current ?? 'none'
  const hasHomeUnderlay = homeUnderlay !== null
  const currentHomeDate = layout === 'home' ? props.date : undefined
  const sheetRef = useRef<HTMLElement>(null)
  const dragRef = useRef<MobileSheetDrag | null>(null)
  const touchDragRef = useRef<MobileSheetTouchDrag | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clickResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasNavigatedRef = useRef(false)
  const suppressClickRef = useRef(false)
  const [sheetState, setSheetState] = useState<MobileSheetState>(() =>
    layout !== 'home' && homeUnderlayOrigin === 'retained' ? 'entering' : 'open'
  )

  useEffect(
    () => () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
      if (clickResetTimerRef.current) clearTimeout(clickResetTimerRef.current)
    },
    []
  )

  useEffect(() => {
    if (layout === 'home') return

    return listenForMobileViewportChanges(
      () => {
        if (!dragRef.current && !touchDragRef.current?.active) return

        if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
        dragRef.current = null
        touchDragRef.current = null
        sheetRef.current?.style.setProperty('--merchant-sheet-drag-y', '0px')
        setSheetState('open')
      },
      window,
      window.visualViewport
    )
  }, [layout])

  useEffect(() => {
    if (layout === 'home' && mobileHomeUnderlay) {
      mobileHomeUnderlay.content.current = children
      mobileHomeUnderlay.date.current = currentHomeDate
      mobileHomeUnderlay.origin.current = 'retained'
    }
  }, [children, currentHomeDate, layout, mobileHomeUnderlay])

  useEffect(() => {
    if (layout === 'home') return
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
          deltaY: touch.clientY - drag.startY,
          scrollTop: drag.scrollElement?.scrollTop ?? 0
        })
      if (shouldTakeOver) event.preventDefault()
    }

    sheet.addEventListener('touchmove', preventPageScrollDuringSheetDrag, {
      passive: false
    })
    return () => {
      sheet.removeEventListener('touchmove', preventPageScrollDuringSheetDrag)
    }
  }, [layout])

  if (layout === 'home') {
    return (
      <main className="merchant-mobile min-h-dvh bg-background text-foreground">
        <section className="merchant-safe-area-inline min-w-0 px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-60">
          {children}
        </section>
        <MobileHomeActions
          destinations={destinations}
          appointmentDate={currentHomeDate}
        />
      </main>
    )
  }

  const navigateBack = () => {
    if (hasNavigatedRef.current) return
    hasNavigatedRef.current = true
    const openedFromMerchantApp = hasMobileSheetNavigationOrigin(location.state)

    document.documentElement.dataset.merchantNavigationSurface = 'sheet'
    setTimeout(() => {
      delete document.documentElement.dataset.merchantNavigationSurface
    }, 400)

    if (openedFromMerchantApp) {
      router.history.back()
      return
    }

    const appointmentDate =
      typeof (location.search as { readonly date?: unknown }).date === 'string'
        ? (location.search as { readonly date: string }).date
        : undefined
    void router.navigate({
      to: '/appointments',
      search: { date: appointmentDate },
      replace: true,
      viewTransition: false
    })
  }

  const closeSheet = () => {
    if (sheetState === 'closing') return
    dragRef.current = null
    touchDragRef.current = null
    setSheetState('closing')
    sheetRef.current?.style.setProperty('--merchant-sheet-drag-y', '100dvh')
    closeTimerRef.current = setTimeout(navigateBack, 320)
  }

  const settleSheet = () => {
    dragRef.current = null
    touchDragRef.current = null
    setSheetState('settling')
    sheetRef.current?.style.setProperty('--merchant-sheet-drag-y', '0px')
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0 || sheetState === 'closing') return

    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startTime: performance.now(),
      distance: 0
    }
    setSheetState('dragging')
    sheetRef.current?.style.setProperty('--merchant-sheet-drag-y', '0px')
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    drag.distance = Math.max(0, event.clientY - drag.startY)
    const offset = getMobileSheetDragOffset(drag.distance, mobileViewportHeight())
    sheetRef.current?.style.setProperty('--merchant-sheet-drag-y', `${offset}px`)
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    suppressClickRef.current = drag.distance > 6
    if (clickResetTimerRef.current) clearTimeout(clickResetTimerRef.current)
    clickResetTimerRef.current = setTimeout(() => {
      suppressClickRef.current = false
    }, 350)

    if (
      shouldDismissMobileSheet({
        distance: drag.distance,
        duration: performance.now() - drag.startTime
      })
    ) {
      closeSheet()
      return
    }

    settleSheet()
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
      startX: touch.clientX,
      startY: touch.clientY,
      startTime: performance.now(),
      active: false,
      distance: 0
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
    if (!drag.active) {
      if (
        !shouldBeginMobileSheetSurfaceDrag({
          deltaX,
          deltaY,
          scrollTop: drag.scrollElement?.scrollTop ?? 0
        })
      ) {
        if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= 8) {
          touchDragRef.current = null
        }
        return
      }
      drag.active = true
      setSheetState('dragging')
      sheetRef.current?.style.setProperty('--merchant-sheet-drag-y', '0px')
    }

    event.preventDefault()
    drag.distance = Math.max(0, deltaY)
    const offset = getMobileSheetDragOffset(drag.distance, mobileViewportHeight())
    sheetRef.current?.style.setProperty('--merchant-sheet-drag-y', `${offset}px`)
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
    if (clickResetTimerRef.current) clearTimeout(clickResetTimerRef.current)
    clickResetTimerRef.current = setTimeout(() => {
      suppressClickRef.current = false
    }, 350)

    if (
      shouldDismissMobileSheet({
        distance: drag.distance,
        duration: performance.now() - drag.startTime
      })
    ) {
      closeSheet()
      return
    }

    settleSheet()
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

  const handleTransitionEnd = (event: TransitionEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== 'transform')
      return
    if (sheetState === 'closing') navigateBack()
    if (sheetState === 'settling') setSheetState('open')
  }

  const handleAnimationEnd = (event: AnimationEvent<HTMLElement>) => {
    if (
      event.target === event.currentTarget &&
      event.animationName === 'merchant-route-sheet-enter' &&
      sheetState === 'entering'
    ) {
      setSheetState('open')
    }
  }

  return (
    <main className="merchant-mobile relative min-h-dvh overflow-hidden bg-background text-foreground">
      {hasHomeUnderlay ? (
        <div
          aria-hidden
          inert
          className="absolute inset-0 z-0 overflow-hidden bg-background opacity-65"
        >
          <section className="merchant-safe-area-inline min-w-0 px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-60">
            {homeUnderlay}
          </section>
          <MobileHomeActions destinations={destinations} appointmentDate={homeDate} />
        </div>
      ) : null}
      <section
        ref={sheetRef}
        aria-labelledby="merchant-mobile-sheet-title"
        data-mobile-surface={layout}
        data-mobile-underlay-origin={homeUnderlayOrigin}
        data-mobile-sheet-state={sheetState}
        onClickCapture={handleClickCapture}
        onAnimationEnd={handleAnimationEnd}
        onTouchCancel={handleTouchCancel}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
        onTouchStart={handleTouchStart}
        onTransitionEnd={handleTransitionEnd}
        className="merchant-route-sheet relative z-10 mt-6 flex min-h-[calc(100dvh-1.5rem)] flex-col overflow-hidden rounded-t-[2.25rem] border-t bg-background"
      >
        <button
          type="button"
          aria-label={`Close ${props.title}`}
          data-mobile-sheet-handle="true"
          className="merchant-sheet-drag-zone -mb-4 flex h-11 shrink-0 justify-center pt-3"
          onClick={() => {
            if (suppressClickRef.current) return
            closeSheet()
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
        >
          <span aria-hidden className="h-1 w-10 rounded-full bg-muted-foreground/20" />
        </button>
        <header className="merchant-safe-area-inline sticky top-0 z-20 bg-background/92 px-5 pb-3 backdrop-blur-xl">
          <h1
            id="merchant-mobile-sheet-title"
            className="truncate text-2xl font-bold tracking-tight"
          >
            {props.title}
          </h1>
        </header>
        <div
          data-mobile-sheet-scroll="true"
          className="merchant-safe-area-inline min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(2rem,env(safe-area-inset-bottom))]"
        >
          <p className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            {section.kind === 'catalog' ? 'Merchant catalog' : 'Merchant App'}
          </p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {props.description}
          </p>
          {children}
        </div>
      </section>
    </main>
  )
}
