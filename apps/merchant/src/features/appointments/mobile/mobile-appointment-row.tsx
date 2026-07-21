import { Link } from '@tanstack/react-router'
import { mobileSheetNavigationState } from '@/components/merchant-shell/mobile/mobile-sheet-gesture.ts'
import { Check, Circle, Minus, X } from 'lucide-react'
import type { MobileAppointmentLedgerEntry } from './mobile-appointments-model.ts'

const statusPresentation = {
  scheduled: { icon: Circle, label: 'Scheduled', className: 'text-info' },
  completed: { icon: Check, label: 'Completed', className: 'text-muted-foreground' },
  cancelled: { icon: X, label: 'Cancelled', className: 'text-destructive' },
  no_show: { icon: Minus, label: 'No show', className: 'text-destructive' }
} as const

export function MobileAppointmentRow({
  appointment,
  date
}: {
  readonly appointment: MobileAppointmentLedgerEntry
  readonly date: string
}) {
  const status = statusPresentation[appointment.status]
  const StatusIcon = status.icon
  return (
    <li className="border-b border-dashed border-border/70 last:border-b-0">
      <Link
        to="/appointments/$appointmentId"
        viewTransition={false}
        state={mobileSheetNavigationState}
        params={{ appointmentId: appointment.id }}
        search={{ date }}
        className="grid min-h-24 grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 py-4"
        aria-label={`${appointment.customerName}, ${appointment.time}, ${status.label}`}
      >
        <StatusIcon className={`size-6 ${status.className}`} strokeWidth={2.5} />
        <span className="min-w-0">
          <span className="block truncate text-lg font-bold text-foreground">
            {appointment.customerName}
          </span>
          <span className="mt-1 block truncate text-xs font-medium text-muted-foreground">
            {appointment.serviceNames || 'Appointment'} · {appointment.providerName}
          </span>
        </span>
        <time
          className="font-mono text-base font-bold text-muted-foreground tabular-nums"
          dateTime={appointment.startsAt}
        >
          {appointment.time}
        </time>
      </Link>
    </li>
  )
}
