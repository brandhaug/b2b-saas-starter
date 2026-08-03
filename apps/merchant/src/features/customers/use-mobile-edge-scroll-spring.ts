import { useEffect, useRef } from 'react'

const EDGE_SPRING_MIN_VELOCITY = 0.5
const EDGE_SPRING_MAX_OFFSET = 16
const EDGE_SPRING_MIN_OFFSET = 6
const EDGE_SPRING_RESPONSE = 0.36
const EDGE_SPRING_DAMPING_RATIO = 0.62
const EDGE_SPRING_STIFFNESS = (2 * Math.PI) ** 2 / EDGE_SPRING_RESPONSE ** 2
const EDGE_SPRING_DAMPING =
  2 * EDGE_SPRING_DAMPING_RATIO * Math.sqrt(EDGE_SPRING_STIFFNESS)

export function mobileEdgeSpringOffset({
  atBottom,
  atTop,
  velocity
}: {
  readonly atBottom: boolean
  readonly atTop: boolean
  readonly velocity: number
}) {
  if (Math.abs(velocity) < EDGE_SPRING_MIN_VELOCITY) return 0

  const amplitude = Math.min(
    EDGE_SPRING_MAX_OFFSET,
    Math.max(EDGE_SPRING_MIN_OFFSET, Math.abs(velocity) * 12)
  )
  if (atTop && velocity < 0) return amplitude
  if (atBottom && velocity > 0) return -amplitude
  return 0
}

export function useMobileEdgeScrollSpring() {
  const surfaceRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    const surface = surfaceRef.current
    const scrollport = surface?.closest<HTMLElement>('[data-mobile-sheet-scroll]')
    if (!surface || !scrollport) return

    let animationFrame: number | null = null
    let filteredVelocity = 0
    let lastInteractionTime = 0
    let lastInputVelocityTime = 0
    let lastScrollTime = performance.now()
    let lastScrollTop = scrollport.scrollTop
    let lastSpringTime = 0
    let lastTouchTime = 0
    let lastTouchY: number | null = null
    let recentInputVelocity = 0

    const setOffset = (offset: number, active: boolean) => {
      surface.dataset.mobileEdgeSpring = active ? 'active' : 'idle'
      surface.style.transform = `translate3d(0, ${offset}px, 0)`
      surface.style.willChange = active ? 'transform' : ''
    }

    const stopSpring = () => {
      if (animationFrame !== null) cancelAnimationFrame(animationFrame)
      animationFrame = null
      setOffset(0, false)
    }

    const animateSpring = (initialOffset: number) => {
      stopSpring()
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return

      let position = initialOffset
      let velocity = 0
      let previousTime = performance.now()
      setOffset(position, true)

      const step = (time: number) => {
        const elapsed = Math.min(Math.max((time - previousTime) / 1_000, 0.001), 0.032)
        previousTime = time
        const acceleration =
          -EDGE_SPRING_STIFFNESS * position - EDGE_SPRING_DAMPING * velocity
        velocity += acceleration * elapsed
        position += velocity * elapsed
        setOffset(position, true)

        if (Math.abs(position) <= 0.15 && Math.abs(velocity) <= 4) {
          animationFrame = null
          setOffset(0, false)
          return
        }
        animationFrame = requestAnimationFrame(step)
      }

      animationFrame = requestAnimationFrame(step)
    }

    const markInteraction = () => {
      lastInteractionTime = performance.now()
    }

    const handleInteractionStart = () => {
      markInteraction()
      stopSpring()
    }

    const handleTouchStart = (event: TouchEvent) => {
      handleInteractionStart()
      const touch = event.touches[0]
      lastTouchY = touch?.clientY ?? null
      lastTouchTime = performance.now()
      recentInputVelocity = 0
    }

    const handleTouchMove = (event: TouchEvent) => {
      markInteraction()
      const touch = event.touches[0]
      if (!touch || lastTouchY === null) return
      const now = performance.now()
      const elapsed = Math.max(now - lastTouchTime, 1)
      recentInputVelocity = Math.max(
        -3,
        Math.min(3, (lastTouchY - touch.clientY) / elapsed)
      )
      lastInputVelocityTime = now
      lastTouchY = touch.clientY
      lastTouchTime = now
    }

    const handleWheel = (event: WheelEvent) => {
      const now = performance.now()
      lastInteractionTime = now
      lastInputVelocityTime = now
      recentInputVelocity = Math.max(-3, Math.min(3, event.deltaY / 16))
    }

    const handleScroll = () => {
      const now = performance.now()
      const scrollTop = scrollport.scrollTop
      const elapsed = Math.max(now - lastScrollTime, 1)
      const instantaneousVelocity = (scrollTop - lastScrollTop) / elapsed
      filteredVelocity = filteredVelocity * 0.25 + instantaneousVelocity * 0.75
      lastScrollTime = now
      lastScrollTop = scrollTop

      const overflowing = scrollport.scrollHeight > scrollport.clientHeight + 1
      if (
        !overflowing ||
        now - lastInteractionTime > 1_400 ||
        now - lastSpringTime < 220
      )
        return

      const remaining =
        scrollport.scrollHeight - scrollport.clientHeight - scrollport.scrollTop
      const velocity =
        now - lastInputVelocityTime <= 120 &&
        Math.abs(recentInputVelocity) > Math.abs(filteredVelocity)
          ? recentInputVelocity
          : filteredVelocity
      const offset = mobileEdgeSpringOffset({
        atBottom: remaining <= 1,
        atTop: scrollTop <= 1,
        velocity
      })
      if (offset === 0) return

      lastSpringTime = now
      animateSpring(offset)
    }

    scrollport.addEventListener('scroll', handleScroll, { passive: true })
    scrollport.addEventListener('touchstart', handleTouchStart, {
      passive: true
    })
    scrollport.addEventListener('touchmove', handleTouchMove, { passive: true })
    scrollport.addEventListener('pointerdown', handleInteractionStart, {
      passive: true
    })
    scrollport.addEventListener('wheel', handleWheel, { passive: true })

    return () => {
      stopSpring()
      scrollport.removeEventListener('scroll', handleScroll)
      scrollport.removeEventListener('touchstart', handleTouchStart)
      scrollport.removeEventListener('touchmove', handleTouchMove)
      scrollport.removeEventListener('pointerdown', handleInteractionStart)
      scrollport.removeEventListener('wheel', handleWheel)
    }
  }, [])

  return surfaceRef
}
