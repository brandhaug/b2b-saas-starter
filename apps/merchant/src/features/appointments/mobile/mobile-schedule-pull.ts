const PULL_START_DISTANCE = 8
const PULL_AXIS_RATIO = 1.15
const PULL_COMMIT_RATIO = 0.46
const PULL_COMMIT_VELOCITY = 520

export function mobileScheduleGreeting(
  timezone: string,
  now = new Date(),
  viewerName?: string
) {
  const hour = Number(
    new Intl.DateTimeFormat('en', {
      hour: '2-digit',
      hourCycle: 'h23',
      timeZone: timezone
    }).format(now)
  )
  const daypart =
    hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const firstName = viewerName?.trim().split(/\s+/)[0]
  return firstName ? `${daypart}, ${firstName}` : daypart
}

export function mobileSchedulePullMaxOffset(viewportHeight: number) {
  return Math.min(560, Math.max(300, viewportHeight * 0.62))
}

export function mobileSchedulePullRevealProgress(progress: number) {
  const boundedProgress = Math.min(1, Math.max(0, progress))
  return 1 - (1 - boundedProgress) ** 2
}

export function shouldBeginMobileSchedulePull({
  deltaX,
  deltaY,
  expanded,
  scrollTop
}: {
  readonly deltaX: number
  readonly deltaY: number
  readonly expanded: boolean
  readonly scrollTop: number
}) {
  if (scrollTop > 1) return false
  if (!expanded && deltaY <= 0) return false
  return (
    Math.abs(deltaY) >= PULL_START_DISTANCE &&
    Math.abs(deltaY) > Math.abs(deltaX) * PULL_AXIS_RATIO
  )
}

export function mobileSchedulePullOffset({
  deltaY,
  maxOffset,
  startOffset
}: {
  readonly deltaY: number
  readonly maxOffset: number
  readonly startOffset: number
}) {
  return Math.min(maxOffset, Math.max(0, startOffset + deltaY))
}

export function mobileSchedulePullTarget({
  maxOffset,
  offset,
  velocity
}: {
  readonly maxOffset: number
  readonly offset: number
  readonly velocity: number
}) {
  if (velocity >= PULL_COMMIT_VELOCITY) return maxOffset
  if (velocity <= -PULL_COMMIT_VELOCITY) return 0
  return offset >= maxOffset * PULL_COMMIT_RATIO ? maxOffset : 0
}

export function mobileSchedulePullVelocity(distance: number, duration: number) {
  return (distance / Math.max(duration, 1)) * 1_000
}
