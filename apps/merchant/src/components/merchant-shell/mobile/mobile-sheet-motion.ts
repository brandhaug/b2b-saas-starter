export const POKE_MOBILE_SHEET_SPRING = {
  stiffness: 580,
  damping: 60,
  mass: 1.35
} as const

export function scheduleAfterNextPaint(callback: () => void) {
  let secondFrame = 0
  const firstFrame = requestAnimationFrame(() => {
    secondFrame = requestAnimationFrame(callback)
  })

  return () => {
    cancelAnimationFrame(firstFrame)
    if (secondFrame) cancelAnimationFrame(secondFrame)
  }
}

export function getMobileSheetReleaseVelocity(
  distance: number,
  duration: number,
  viewportHeight: number
) {
  return Math.min(
    viewportHeight * 3,
    (Math.max(0, distance) / Math.max(duration, 1)) * 1000
  )
}

type MobileSheetSpringOptions = {
  readonly from: number
  readonly initialVelocity?: number | undefined
  readonly max: number
  readonly onComplete: () => void
  readonly onUpdate: (position: number) => void
  readonly to: number
}

export function animateMobileSheetSpring({
  from,
  initialVelocity = 0,
  max,
  onComplete,
  onUpdate,
  to
}: MobileSheetSpringOptions) {
  let position = Math.min(max, Math.max(0, from))
  let velocity = initialVelocity
  let frame = 0
  let previousTime: number | null = null
  let cancelled = false

  const finish = () => {
    onUpdate(to)
    onComplete()
  }

  if (Math.abs(position - to) < 0.5 && Math.abs(velocity) < 5) {
    finish()
    return () => {}
  }

  const tick = (time: number) => {
    if (cancelled) return
    if (previousTime === null) previousTime = time
    let remaining = Math.min(0.032, Math.max(0.001, (time - previousTime) / 1000))
    previousTime = time

    while (remaining > 0) {
      const step = Math.min(remaining, 1 / 120)
      const springForce = -POKE_MOBILE_SHEET_SPRING.stiffness * (position - to)
      const dampingForce = -POKE_MOBILE_SHEET_SPRING.damping * velocity
      velocity += ((springForce + dampingForce) / POKE_MOBILE_SHEET_SPRING.mass) * step
      position += velocity * step
      remaining -= step
    }

    position = Math.min(max, Math.max(0, position))
    onUpdate(position)

    if (Math.abs(position - to) < 0.5 && Math.abs(velocity) < 5) {
      finish()
      return
    }
    frame = requestAnimationFrame(tick)
  }

  frame = requestAnimationFrame(tick)
  return () => {
    cancelled = true
    cancelAnimationFrame(frame)
  }
}
