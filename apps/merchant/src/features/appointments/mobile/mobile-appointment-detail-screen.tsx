import type { OperationalAppointment } from '@b2b-saas-starter/capabilities/booking'
import { CalendarPlus, Check, Circle, Mail, Minus, Phone, X } from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'
import { appointmentDetailValues } from '../shared/appointment-detail-values.ts'

type AppointmentStatus = OperationalAppointment['status']

type StatusPresentation = {
  readonly label: string
  readonly className: string
  readonly icon: ComponentType<SVGProps<SVGSVGElement>>
}

const statusPresentations: Record<AppointmentStatus, StatusPresentation> = {
  scheduled: {
    label: 'Scheduled',
    className: 'bg-info/12 text-info',
    icon: Circle
  },
  completed: {
    label: 'Completed',
    className: 'bg-success/12 text-success',
    icon: Check
  },
  cancelled: {
    label: 'Cancelled',
    className: 'bg-destructive/12 text-destructive',
    icon: X
  },
  no_show: {
    label: 'No show',
    className: 'bg-destructive/12 text-destructive',
    icon: Minus
  }
}

export function mobileAppointmentPaymentLabel(
  appointment: Pick<OperationalAppointment, 'status' | 'snapshot'>
) {
  if (appointment.snapshot.checkoutPath === 'online_payment')
    return appointment.status === 'cancelled' ? 'Online payment' : 'Paid online'
  return appointment.status === 'scheduled' ? 'Due in person' : 'Pay in person'
}

export function MobileAppointmentDetailScreen({
  appointment,
  bookingUrl,
  contactActionsEnabled = true
}: {
  readonly appointment: OperationalAppointment
  readonly bookingUrl?: string | undefined
  readonly contactActionsEnabled?: boolean
}) {
  const snapshot = appointment.snapshot
  const values = appointmentDetailValues(appointment)
  const status = statusPresentations[appointment.status]
  const StatusIcon = status.icon
  const serviceNames = snapshot.services.map((service) => service.name).join(' · ')
  const bookingActionLabel =
    appointment.status === 'completed' ? 'Book again' : 'New booking'

  return (
    <article data-mobile-appointment-detail="true" className="flex flex-col pb-1">
      <header className="pt-4">
        <span
          className={`inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold ${status.className}`}
        >
          <StatusIcon aria-hidden className="size-3.5" strokeWidth={2.5} />
          {status.label}
        </span>
        <h2 className="mt-4 text-[2rem] leading-[1.05] font-bold tracking-[-0.035em] text-foreground">
          {snapshot.customerDetails.name}
        </h2>
        {contactActionsEnabled && snapshot.customerDetails.phone ? (
          <a
            href={`tel:${snapshot.customerDetails.phone}`}
            className="mt-1.5 inline-block text-sm font-medium text-muted-foreground"
          >
            {snapshot.customerDetails.phone}
          </a>
        ) : contactActionsEnabled ? (
          <p className="mt-1.5 text-sm font-medium text-muted-foreground">
            {snapshot.customerDetails.email}
          </p>
        ) : (
          <p className="mt-1.5 text-sm font-medium text-muted-foreground">
            Loading contact…
          </p>
        )}
      </header>

      <section aria-label="Appointment schedule" className="mt-7">
        <p className="text-[1.0625rem] leading-6 font-semibold text-foreground">
          {values.scheduledTime}
        </p>
        <p className="mt-1 text-[0.9375rem] leading-5 text-muted-foreground">
          {serviceNames || 'Appointment'}
        </p>
        <p className="mt-1 text-[0.8125rem] leading-5 text-muted-foreground">
          with {snapshot.assignedProvider.displayName}
        </p>
      </section>

      <section
        aria-label="Appointment total"
        className="mt-6 rounded-[1.5rem] bg-muted/70 p-4"
      >
        <div className="flex items-start justify-between gap-5">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Services</p>
            <ul className="mt-2 grid gap-1">
              {snapshot.services.map((service) => (
                <li
                  key={`${service.role}-${service.id}`}
                  className="flex items-center gap-2 text-xs text-muted-foreground"
                >
                  <span className="min-w-0 flex-1 truncate">{service.name}</span>
                  <span className="shrink-0 tabular-nums">
                    {service.durationMinutes} min
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="shrink-0 text-right">
            <span className="inline-flex rounded-lg bg-background/75 px-2 py-1 text-[0.6875rem] leading-4 font-bold tracking-wide uppercase">
              {mobileAppointmentPaymentLabel(appointment)}
            </span>
            <p className="mt-2 text-2xl leading-none font-bold tracking-tight tabular-nums">
              {values.quotedTotal}
            </p>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-border/65 pt-3 text-xs">
          <span className="text-muted-foreground">Provider preference</span>
          <span className="max-w-[60%] truncate text-right font-semibold text-foreground">
            {values.providerPreference}
          </span>
        </div>
      </section>

      <nav
        aria-label="Appointment actions"
        className="mt-auto grid grid-cols-3 gap-2 pt-8"
      >
        {contactActionsEnabled && snapshot.customerDetails.phone ? (
          <AppointmentAction
            href={`tel:${snapshot.customerDetails.phone}`}
            icon={Phone}
            label="Call"
          />
        ) : (
          <AppointmentAction
            icon={Phone}
            label={contactActionsEnabled ? 'No phone' : 'Contact'}
            disabled
          />
        )}
        <AppointmentAction
          href={
            contactActionsEnabled
              ? `mailto:${snapshot.customerDetails.email}`
              : undefined
          }
          icon={Mail}
          label="Email"
          disabled={!contactActionsEnabled}
        />
        <AppointmentAction
          href={bookingUrl}
          icon={CalendarPlus}
          label={bookingActionLabel}
          primary
          disabled={!bookingUrl}
        />
      </nav>
    </article>
  )
}

function AppointmentAction({
  href,
  icon: Icon,
  label,
  primary = false,
  disabled = false
}: {
  readonly href?: string | undefined
  readonly icon: ComponentType<SVGProps<SVGSVGElement>>
  readonly label: string
  readonly primary?: boolean
  readonly disabled?: boolean
}) {
  const className = [
    'flex min-h-24 flex-col items-center justify-center gap-2 rounded-[1.35rem] px-2 text-center transition-transform active:scale-[0.97]',
    primary ? 'bg-primary text-primary-foreground' : 'bg-muted/75 text-foreground',
    disabled ? 'pointer-events-none opacity-40' : ''
  ].join(' ')
  const content = (
    <>
      <Icon aria-hidden className="size-5" strokeWidth={2.25} />
      <span className="text-xs font-semibold">{label}</span>
    </>
  )

  return href && !disabled ? (
    <a href={href} className={className}>
      {content}
    </a>
  ) : (
    <span aria-disabled="true" className={className}>
      {content}
    </span>
  )
}
