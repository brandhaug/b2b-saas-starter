import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type TouchEvent as ReactTouchEvent
} from 'react'
import { animateMobileSheetSpring } from '@/components/merchant-shell/mobile/mobile-sheet-motion.ts'
import { MerchantHomeHero } from '@/components/merchant-shell/home-atmosphere.tsx'
import {
  mobileSchedulePullMaxOffset,
  mobileSchedulePullOffset,
  mobileSchedulePullRevealProgress,
  mobileSchedulePullTarget,
  mobileSchedulePullVelocity,
  shouldBeginMobileSchedulePull
} from './mobile-schedule-pull.ts'

type PullState = 'closed' | 'dragging' | 'settling' | 'open'

type PullGesture = {
  readonly identifier: number
  readonly maxOffset: number
  readonly startOffset: number
  readonly startTime: number
  readonly startX: number
  readonly startY: number
  active: boolean
  lastY: number
}

export function MobileSchedulePullSurface({
  greeting,
  summary,
  children
}: {
  readonly greeting: string
  readonly summary: ReactNode
  readonly children: ReactNode
}) {
  const regionRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<HTMLElement>(null)
  const homeViewportRef = useRef<HTMLElement | null>(null)
  const gestureRef = useRef<PullGesture | null>(null)
  const positionRef = useRef(0)
  const animationRef = useRef<(() => void) | null>(null)
  const [state, setState] = useState<PullState>('closed')

  const updatePosition = (position: number, maxOffset: number) => {
    const progress = Math.min(1, position / Math.max(maxOffset, 1))
    const revealProgress = mobileSchedulePullRevealProgress(progress)
    positionRef.current = position
    surfaceRef.current?.style.setProperty('--merchant-schedule-pull-y', `${position}px`)
    regionRef.current?.style.setProperty(
      '--merchant-schedule-pull-progress',
      String(progress)
    )
    regionRef.current?.style.setProperty(
      '--merchant-schedule-pull-reveal-progress',
      String(revealProgress)
    )
    const homeViewport =
      homeViewportRef.current ??
      regionRef.current?.closest<HTMLElement>('[data-mobile-home-viewport]') ??
      null
    homeViewportRef.current = homeViewport
    homeViewport?.style.setProperty(
      '--merchant-schedule-pull-progress',
      String(progress)
    )
  }

  const settleTo = (target: number, initialVelocity = 0) => {
    const height = regionRef.current?.clientHeight ?? window.innerHeight
    const maxOffset = mobileSchedulePullMaxOffset(height)
    animationRef.current?.()
    setState('settling')
    animationRef.current = animateMobileSheetSpring({
      from: positionRef.current,
      initialVelocity,
      max: maxOffset,
      to: target,
      onUpdate: (position) => updatePosition(position, maxOffset),
      onComplete: () => {
        animationRef.current = null
        setState(target === 0 ? 'closed' : 'open')
      }
    })
  }

  useEffect(
    () => () => {
      animationRef.current?.()
      homeViewportRef.current?.style.removeProperty('--merchant-schedule-pull-progress')
    },
    []
  )

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return

    const handleTouchMove = (event: TouchEvent) => {
      const gesture = gestureRef.current
      if (!gesture) return
      const touch = Array.from(event.touches).find(
        (candidate) => candidate.identifier === gesture.identifier
      )
      if (!touch) return

      const deltaX = touch.clientX - gesture.startX
      const deltaY = touch.clientY - gesture.startY
      gesture.lastY = touch.clientY
      if (!gesture.active) {
        const scrollTop =
          surface.querySelector<HTMLElement>('[data-mobile-appointment-scroll]')
            ?.scrollTop ?? 0
        if (
          !shouldBeginMobileSchedulePull({
            deltaX,
            deltaY,
            expanded: gesture.startOffset > 0,
            scrollTop
          })
        ) {
          if (Math.abs(deltaX) >= 8 || Math.abs(deltaY) >= 8) gestureRef.current = null
          return
        }
        gesture.active = true
        animationRef.current?.()
        animationRef.current = null
        setState('dragging')
      }

      event.preventDefault()
      updatePosition(
        mobileSchedulePullOffset({
          deltaY,
          maxOffset: gesture.maxOffset,
          startOffset: gesture.startOffset
        }),
        gesture.maxOffset
      )
    }

    surface.addEventListener('touchmove', handleTouchMove, { passive: false })
    return () => surface.removeEventListener('touchmove', handleTouchMove)
  }, [])

  const handleTouchStart = (event: ReactTouchEvent<HTMLElement>) => {
    if (event.touches.length !== 1) return
    const touch = event.touches[0]
    if (!touch) return
    const height = regionRef.current?.clientHeight ?? window.innerHeight
    gestureRef.current = {
      identifier: touch.identifier,
      maxOffset: mobileSchedulePullMaxOffset(height),
      startOffset: positionRef.current,
      startTime: performance.now(),
      startX: touch.clientX,
      startY: touch.clientY,
      active: false,
      lastY: touch.clientY
    }
  }

  const finishGesture = (event: ReactTouchEvent<HTMLElement>) => {
    const gesture = gestureRef.current
    if (!gesture) return
    gestureRef.current = null
    if (!gesture.active) return

    const touch = Array.from(event.changedTouches).find(
      (candidate) => candidate.identifier === gesture.identifier
    )
    const distance = (touch?.clientY ?? gesture.lastY) - gesture.startY
    const velocity = mobileSchedulePullVelocity(
      distance,
      performance.now() - gesture.startTime
    )
    const target = mobileSchedulePullTarget({
      maxOffset: gesture.maxOffset,
      offset: positionRef.current,
      velocity
    })
    settleTo(target, velocity)
  }

  const expanded = state === 'open' || (state !== 'closed' && positionRef.current > 0)

  return (
    <div
      ref={regionRef}
      data-mobile-schedule-pull-region="true"
      className="merchant-mobile-schedule-pull-region relative min-h-0 flex-1"
    >
      <aside
        data-mobile-day-summary="true"
        aria-label="Day summary"
        aria-hidden={!expanded}
        className="merchant-mobile-day-summary absolute inset-x-0 top-9 px-1"
      >
        <MerchantHomeHero className="merchant-mobile-day-summary-hero" />
        <div className="relative z-10">
          <h2 className="text-[clamp(1rem,8vw,1.5rem)] leading-[1.04] font-black tracking-[-0.04em] text-foreground">
            {greeting}
          </h2>
          <p className="max-w-md text-[clamp(1rem,7vw,1.5rem)] leading-[1.08] font-black tracking-[-0.035em]">
            {summary}
          </p>
        </div>
      </aside>

      <section
        ref={surfaceRef}
        data-mobile-schedule-pull-surface="true"
        data-mobile-schedule-pull-state={state}
        className="merchant-mobile-schedule-pull-surface relative z-10 flex h-full min-h-0 flex-col overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchEnd={finishGesture}
        onTouchCancel={finishGesture}
      >
        {state === 'closed' ? null : (
          <button
            type="button"
            aria-label={expanded ? 'Hide day summary' : 'Show day summary'}
            aria-expanded={expanded}
            className="absolute inset-x-0 top-1 z-20 mx-auto flex h-5 w-16 touch-manipulation items-start justify-center"
            onClick={() => {
              const height = regionRef.current?.clientHeight ?? window.innerHeight
              settleTo(expanded ? 0 : mobileSchedulePullMaxOffset(height))
            }}
          >
            <span
              aria-hidden
              className="mt-1 h-1 w-10 rounded-full bg-muted-foreground/15"
            />
          </button>
        )}
        <div className="merchant-mobile-schedule-pull-content flex min-h-0 flex-1 flex-col">
          {children}
        </div>
      </section>
    </div>
  )
}
