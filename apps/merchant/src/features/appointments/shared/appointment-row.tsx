import { Link } from '@tanstack/react-router'
import { merchantOverlayNavigationState } from '@/lib/merchant-home-route.ts'
import { appointmentRowStatus } from './appointment-row-status.ts'

export type AppointmentRowEntry = {
  readonly id: string
  readonly customerName: string
  readonly providerName: string
  readonly serviceNames: string
  readonly startsAt: string
  readonly status: keyof typeof appointmentRowStatus
  readonly time: string
}

const densityStyles = {
  compact: {
    item: "relative after:pointer-events-none after:absolute after:inset-x-3 after:bottom-0 after:border-b after:border-dashed after:border-border/70 after:content-[''] last:after:hidden",
    link: 'grid min-h-16 grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-2.5 px-3 py-2',
    icon: 'size-[1.125rem]',
    iconStrokeWidth: 2.25,
    customer: 'block truncate text-sm font-semibold text-foreground',
    details:
      'mt-0.5 block truncate text-[0.6875rem] leading-4 font-medium text-muted-foreground',
    time: 'font-mono text-xs font-semibold text-muted-foreground tabular-nums'
  },
  comfortable: {
    item: "relative after:pointer-events-none after:absolute after:inset-x-5 after:bottom-0 after:border-b after:border-dashed after:border-border/70 after:content-[''] last:after:hidden",
    link: 'grid min-h-24 grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 px-7 py-4',
    icon: 'size-6',
    iconStrokeWidth: 2.5,
    customer: 'block truncate text-lg font-bold text-foreground',
    details: 'mt-1 block truncate text-xs font-medium text-muted-foreground',
    time: 'font-mono text-base font-bold text-muted-foreground tabular-nums'
  }
} as const

export function AppointmentRow({
  appointment,
  date,
  density
}: {
  readonly appointment: AppointmentRowEntry
  readonly date: string
  readonly density: keyof typeof densityStyles
}) {
  const status = appointmentRowStatus[appointment.status]
  const StatusIcon = status.icon
  const styles = densityStyles[density]

  return (
    <li className={styles.item}>
      <Link
        to="/appointments/$appointmentId"
        viewTransition={false}
        state={(previous) => merchantOverlayNavigationState(previous, date)}
        params={{ appointmentId: appointment.id }}
        search={{ date }}
        data-desktop-appointment-row={density === 'compact' ? 'true' : undefined}
        data-mobile-appointment-row={density === 'comfortable' ? 'true' : undefined}
        className={styles.link}
        aria-label={`${appointment.customerName}, ${appointment.time}, ${status.label}`}
      >
        <StatusIcon
          aria-hidden
          className={`${styles.icon} ${status.className}`}
          strokeWidth={styles.iconStrokeWidth}
        />
        <span className="min-w-0">
          <span className={styles.customer}>{appointment.customerName}</span>
          <span className={styles.details}>
            {appointment.serviceNames || 'Appointment'} · {appointment.providerName}
          </span>
        </span>
        <time className={styles.time} dateTime={appointment.startsAt}>
          {appointment.time}
        </time>
      </Link>
    </li>
  )
}
