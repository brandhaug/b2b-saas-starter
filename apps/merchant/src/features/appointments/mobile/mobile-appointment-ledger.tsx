import type { ProviderCalendar } from '@b2b-saas-starter/capabilities/booking'
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { flushSync } from 'react-dom'
import {
  appointmentDaySwipeVelocity,
  shouldCommitAppointmentDaySwipe
} from './mobile-appointment-day-swipe.ts'
import { MobileAppointmentCarousel } from './mobile-appointment-carousel.tsx'
import type { AppointmentDayDirection } from './week-navigation.ts'

const DAY_SWIPE_START_DISTANCE = 8
const DAY_SWIPE_AXIS_RATIO = 1.15
const DAY_SWIPE_MAX_VELOCITY = 3.2
const DAY_SWIPE_SPRING_RESPONSE = 0.32
const DAY_SWIPE_SPRING_DAMPING_RATIO = 0.86
const DAY_SWIPE_SPRING_STIFFNESS = (2 * Math.PI) ** 2 / DAY_SWIPE_SPRING_RESPONSE ** 2
const DAY_SWIPE_SPRING_DAMPING =
  2 * DAY_SWIPE_SPRING_DAMPING_RATIO * Math.sqrt(DAY_SWIPE_SPRING_STIFFNESS)

type DaySwipeVisualState = 'dragging' | 'idle' | 'outgoing' | 'resetting' | 'settling'

type DayCarouselCalendars = {
  readonly current: ProviderCalendar
  readonly next: ProviderCalendar | undefined
  readonly previous: ProviderCalendar | undefined
}

type DaySwipeGesture = {
  readonly pointerId: number
  readonly startTime: number
  readonly startX: number
  readonly startY: number
  readonly startOffset: number
  readonly width: number
  active: boolean
  lastTime: number
  lastX: number
  velocityX: number
}

export function MobileAppointmentLedger({
  calendar,
  previousCalendar,
  nextCalendar,
  pending = false,
  scrollable = false,
  onSwipeDay
}: {
  readonly calendar: ProviderCalendar
  readonly previousCalendar?: ProviderCalendar | undefined
  readonly nextCalendar?: ProviderCalendar | undefined
  readonly pending?: boolean
  readonly scrollable?: boolean
  readonly onSwipeDay?: ((direction: AppointmentDayDirection) => void) | undefined
}) {
  const swipeRef = useRef<DaySwipeGesture | null>(null)
  const suppressClickUntilRef = useRef(0)
  const visualStateRef = useRef<DaySwipeVisualState>('idle')
  const [gestureCalendars, setGestureCalendars] = useState<DayCarouselCalendars | null>(
    null
  )
  const animationFrameRef = useRef<number | null>(null)
  const currentOffsetRef = useRef(0)

  const clearSwipeAnimation = () => {
    if (animationFrameRef.current !== null)
      cancelAnimationFrame(animationFrameRef.current)
    animationFrameRef.current = null
  }

  useEffect(
    () => () => {
      clearSwipeAnimation()
    },
    []
  )

  const setSwipeVisual = (
    element: HTMLElement,
    state: DaySwipeVisualState,
    offset: number
  ) => {
    visualStateRef.current = state
    currentOffsetRef.current = offset
    element.dataset.mobileAppointmentDaySwipeState = state
    element.style.setProperty('--merchant-appointment-day-swipe-x', `${offset}px`)
  }

  const animateSwipeSpring = (
    element: HTMLElement,
    target: number,
    initialVelocity: number,
    state: Extract<DaySwipeVisualState, 'outgoing' | 'settling'>,
    onComplete: () => void
  ) => {
    clearSwipeAnimation()
    if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setSwipeVisual(element, state, target)
      onComplete()
      return
    }
    let position = currentOffsetRef.current
    let velocity = initialVelocity * 1_000
    let previousTime = performance.now()
    setSwipeVisual(element, state, position)
    const step = (time: number) => {
      const elapsed = Math.min(Math.max((time - previousTime) / 1_000, 0.001), 0.032)
      previousTime = time
      const acceleration =
        -DAY_SWIPE_SPRING_STIFFNESS * (position - target) -
        DAY_SWIPE_SPRING_DAMPING * velocity
      velocity += acceleration * elapsed
      position += velocity * elapsed
      setSwipeVisual(element, state, position)
      if (Math.abs(position - target) <= 0.5 && Math.abs(velocity) <= 8) {
        setSwipeVisual(element, state, target)
        animationFrameRef.current = null
        onComplete()
        return
      }
      animationFrameRef.current = requestAnimationFrame(step)
    }
    animationFrameRef.current = requestAnimationFrame(step)
  }

  const settleSwipeVisual = (element: HTMLElement, initialVelocity: number = 0) => {
    animateSwipeSpring(element, 0, initialVelocity, 'settling', () => {
      setGestureCalendars(null)
      setSwipeVisual(element, 'idle', 0)
    })
  }

  const animateCommittedSwipe = (
    element: HTMLElement,
    direction: AppointmentDayDirection,
    width: number,
    initialVelocity: number
  ) => {
    animateSwipeSpring(
      element,
      direction === 'next' ? -width : width,
      initialVelocity,
      'outgoing',
      () => {
        setSwipeVisual(element, 'resetting', 0)
        flushSync(() => setGestureCalendars(null))
        animationFrameRef.current = requestAnimationFrame(() => {
          animationFrameRef.current = null
          setSwipeVisual(element, 'idle', 0)
        })
      }
    )
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    const visualState = visualStateRef.current
    if (
      !onSwipeDay ||
      !event.isPrimary ||
      event.button !== 0 ||
      (visualState !== 'idle' && visualState !== 'settling')
    )
      return
    clearSwipeAnimation()
    if (!gestureCalendars)
      setGestureCalendars({
        current: calendar,
        next: nextCalendar,
        previous: previousCalendar
      })
    const now = performance.now()
    setSwipeVisual(event.currentTarget, 'dragging', currentOffsetRef.current)
    swipeRef.current = {
      pointerId: event.pointerId,
      startTime: now,
      startX: event.clientX,
      startY: event.clientY,
      startOffset: currentOffsetRef.current,
      width: event.currentTarget.clientWidth || 320,
      active: false,
      lastTime: now,
      lastX: event.clientX,
      velocityX: 0
    }
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const swipe = swipeRef.current
    if (!swipe || swipe.pointerId !== event.pointerId) return
    const deltaX = event.clientX - swipe.startX
    const deltaY = event.clientY - swipe.startY
    const now = performance.now()
    const elapsed = now - swipe.lastTime
    if (elapsed > 0) {
      const instantaneousVelocity = Math.max(
        -DAY_SWIPE_MAX_VELOCITY,
        Math.min(DAY_SWIPE_MAX_VELOCITY, (event.clientX - swipe.lastX) / elapsed)
      )
      swipe.velocityX = swipe.velocityX * 0.35 + instantaneousVelocity * 0.65
    }
    swipe.lastTime = now
    swipe.lastX = event.clientX
    if (!swipe.active) {
      if (
        Math.abs(deltaX) < DAY_SWIPE_START_DISTANCE &&
        Math.abs(deltaY) < DAY_SWIPE_START_DISTANCE
      )
        return
      if (Math.abs(deltaX) <= Math.abs(deltaY) * DAY_SWIPE_AXIS_RATIO) {
        swipeRef.current = null
        setGestureCalendars(null)
        setSwipeVisual(event.currentTarget, 'idle', 0)
        return
      }
      swipe.active = true
      event.currentTarget.setPointerCapture?.(event.pointerId)
    }
    event.preventDefault()
    const clampedDeltaX = Math.max(
      -swipe.width,
      Math.min(swipe.width, swipe.startOffset + deltaX)
    )
    setSwipeVisual(event.currentTarget, 'dragging', clampedDeltaX)
  }

  const finishPointerGesture = (event: ReactPointerEvent<HTMLElement>) => {
    const swipe = swipeRef.current
    if (!swipe || swipe.pointerId !== event.pointerId) return
    swipeRef.current = null
    if (!swipe.active) {
      if (swipe.startOffset === 0) {
        setGestureCalendars(null)
        setSwipeVisual(event.currentTarget, 'idle', 0)
      } else settleSwipeVisual(event.currentTarget)
      return
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    suppressClickUntilRef.current = performance.now() + 600
    const distance = swipe.startOffset + swipe.lastX - swipe.startX
    if (
      !shouldCommitAppointmentDaySwipe({
        distance,
        duration: performance.now() - swipe.startTime,
        velocity: swipe.velocityX,
        width: swipe.width
      })
    ) {
      settleSwipeVisual(event.currentTarget, swipe.velocityX)
      return
    }
    const direction =
      (Math.abs(swipe.velocityX) >= appointmentDaySwipeVelocity
        ? swipe.velocityX
        : distance) < 0
        ? 'next'
        : 'previous'
    animateCommittedSwipe(event.currentTarget, direction, swipe.width, swipe.velocityX)
    onSwipeDay?.(direction)
  }

  const cancelPointerGesture = (event: ReactPointerEvent<HTMLElement>) => {
    const swipe = swipeRef.current
    if (!swipe || swipe.pointerId !== event.pointerId) return
    swipeRef.current = null
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    if (swipe.active || swipe.startOffset !== 0) settleSwipeVisual(event.currentTarget)
    else {
      setGestureCalendars(null)
      setSwipeVisual(event.currentTarget, 'idle', 0)
    }
  }

  const handleClickCapture = (event: ReactMouseEvent<HTMLElement>) => {
    if (performance.now() >= suppressClickUntilRef.current) return
    event.preventDefault()
    event.stopPropagation()
  }

  const swipeProps =
    scrollable && onSwipeDay
      ? {
          onClickCapture: handleClickCapture,
          onPointerCancel: cancelPointerGesture,
          onPointerDown: handlePointerDown,
          onPointerMove: handlePointerMove,
          onPointerUp: finishPointerGesture
        }
      : {}
  const carouselProps = scrollable
    ? {
        'data-mobile-appointment-carousel': 'true' as const,
        'data-mobile-appointment-day-swipe-state': 'idle' as const,
        className:
          'merchant-mobile-appointment-carousel min-h-0 flex-1 touch-pan-y overflow-hidden',
        ...swipeProps
      }
    : { className: '' }

  const displayedCalendars = gestureCalendars ?? {
    current: calendar,
    next: nextCalendar,
    previous: previousCalendar
  }

  return (
    <MobileAppointmentCarousel
      calendars={displayedCalendars}
      carouselProps={carouselProps}
      pending={pending}
      scrollable={scrollable}
    />
  )
}
