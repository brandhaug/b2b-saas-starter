const DAY_SWIPE_DISTANCE_RATIO = 0.25
const DAY_SWIPE_MIN_DISTANCE = 44
export const appointmentDaySwipeVelocity = 0.45

export function shouldCommitAppointmentDaySwipe({
  distance,
  duration,
  velocity = 0,
  width
}: {
  readonly distance: number
  readonly duration: number
  readonly velocity?: number
  readonly width: number
}) {
  return (
    Math.abs(distance) >=
      Math.max(DAY_SWIPE_MIN_DISTANCE, width * DAY_SWIPE_DISTANCE_RATIO) ||
    Math.max(Math.abs(distance) / Math.max(duration, 1), Math.abs(velocity)) >=
      appointmentDaySwipeVelocity
  )
}
