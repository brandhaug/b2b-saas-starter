const WEEK_TRANSITION_MS = 240
const MOBILE_SETTLE_MIN_MS = 110
const MOBILE_SETTLE_MAX_MS = 200
const SWIPE_DISTANCE_RATIO = 0.18
const SWIPE_VELOCITY = 0.45

export function shouldCommitAppointmentWeekSwipe({
  distance,
  duration,
  width
}: {
  readonly distance: number
  readonly duration: number
  readonly width: number
}) {
  return (
    Math.abs(distance) >= width * SWIPE_DISTANCE_RATIO ||
    Math.abs(distance) / Math.max(duration, 1) >= SWIPE_VELOCITY
  )
}

export function appointmentWeekSettleDuration({
  distance,
  width
}: {
  readonly distance: number
  readonly width: number
}) {
  const completed = Math.min(1, Math.abs(distance) / Math.max(width, 1))
  return Math.round(
    Math.max(
      MOBILE_SETTLE_MIN_MS,
      Math.min(MOBILE_SETTLE_MAX_MS, WEEK_TRANSITION_MS * (1 - completed))
    )
  )
}
