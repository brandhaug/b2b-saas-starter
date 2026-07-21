import { useLocation, useRouter } from '@tanstack/react-router'
import {
  useEffect,
  useRef,
  useState,
  type AnimationEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type TransitionEvent
} from 'react'
import type { MerchantDestination, MerchantShellSection } from '../navigation.tsx'
import { useMobileHomeUnderlay } from '../merchant-presentation.tsx'
import { MobileHomeActions } from './mobile-home-actions.tsx'
import {
  getMobileSheetDragOffset,
  hasMobileSheetNavigationOrigin,
  shouldDismissMobileSheet
} from './mobile-sheet-gesture.ts'

type MobileSheetState = 'entering' | 'open' | 'dragging' | 'settling' | 'closing'

type MobileSheetDrag = {
  readonly pointerId: number
  readonly startY: number
  readonly startTime: number
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
    if (layout === 'home' && mobileHomeUnderlay) {
      mobileHomeUnderlay.content.current = children
      mobileHomeUnderlay.date.current = currentHomeDate
      mobileHomeUnderlay.origin.current = 'retained'
    }
  }, [children, currentHomeDate, layout, mobileHomeUnderlay])

  if (layout === 'home') {
    return (
      <main className="merchant-mobile min-h-dvh bg-background text-foreground">
        <section className="min-w-0 px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-60">
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
    setSheetState('closing')
    sheetRef.current?.style.setProperty('--merchant-sheet-drag-y', '100dvh')
    closeTimerRef.current = setTimeout(navigateBack, 320)
  }

  const settleSheet = () => {
    dragRef.current = null
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
    const offset = getMobileSheetDragOffset(drag.distance, window.innerHeight)
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
    })

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
          <section className="min-w-0 px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-60">
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
        onAnimationEnd={handleAnimationEnd}
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
        <header className="sticky top-0 z-20 bg-background/92 px-5 pb-3 backdrop-blur-xl">
          <h1
            id="merchant-mobile-sheet-title"
            className="truncate text-2xl font-bold tracking-tight"
          >
            {props.title}
          </h1>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(2rem,env(safe-area-inset-bottom))]">
          <p className="text-xs font-semibold tracking-[0.08em] text-primary uppercase">
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
