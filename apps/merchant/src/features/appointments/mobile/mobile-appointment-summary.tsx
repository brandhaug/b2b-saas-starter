import { CalendarDays } from 'lucide-react'

export function MobileAppointmentSummary({
  appointmentCount,
  isToday,
  pending,
  weekday
}: {
  readonly appointmentCount: number
  readonly isToday: boolean
  readonly pending: boolean
  readonly weekday: string
}) {
  if (pending) {
    return (
      <span data-mobile-appointment-summary="true" className="text-muted-foreground">
        Updating {weekday}&apos;s schedule…
      </span>
    )
  }

  if (appointmentCount === 0) {
    return (
      <span data-mobile-appointment-summary="true">
        <span className="text-muted-foreground">You have </span>
        <span className="text-foreground">nothing</span>{' '}
        <span className="text-muted-foreground">
          {isToday ? 'left today.' : `scheduled on ${weekday}.`}
        </span>
      </span>
    )
  }

  return (
    <span data-mobile-appointment-summary="true">
      <span className="text-muted-foreground">You have </span>
      <span
        data-mobile-appointment-summary-count="true"
        className="whitespace-nowrap text-foreground"
      >
        <CalendarDays
          aria-hidden
          className="mr-[0.18em] inline-block size-[1em] align-[-0.12em]"
          strokeWidth={2.5}
        />
        {appointmentCount} {appointmentCount === 1 ? 'appointment' : 'appointments'}
      </span>{' '}
      <span className="text-muted-foreground">
        {isToday ? 'today.' : `on ${weekday}.`}
      </span>
    </span>
  )
}
