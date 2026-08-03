import type { OperationalAppointment } from '@b2b-saas-starter/capabilities/booking'
import { CalendarPlus, Mail, Phone } from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'
import { appointmentDetailValues } from '../shared/appointment-detail-values.ts'
import { mobileAppointmentPaymentLabel } from './mobile-appointment-detail-model.ts'
import { AppointmentOperationsPanel } from '../shared/appointment-operations-panel.tsx'

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
  const serviceNames = snapshot.services.map((service) => service.name).join(' · ')
  const bookingActionLabel = {
    scheduled: 'New booking',
    completed: 'Book again',
    cancelled: 'Rebook',
    no_show: 'Rebook'
  }[appointment.status]

  return (
    <article
      data-mobile-appointment-detail="true"
      data-mobile-appointment-detail-density="compact"
      data-appointment-status={appointment.status}
      className="flex h-full min-h-full flex-col"
    >
      <header className="pt-2">
        <h2 className="text-[1.75rem] leading-[1.05] font-bold tracking-[-0.035em] text-foreground">
          {snapshot.customerDetails.name}
        </h2>
        {contactActionsEnabled && snapshot.customerDetails.phone ? (
          <a
            href={`tel:${snapshot.customerDetails.phone}`}
            className="mt-1 inline-block text-[0.8125rem] font-medium text-muted-foreground"
          >
            {snapshot.customerDetails.phone}
          </a>
        ) : contactActionsEnabled ? (
          <p className="mt-1 text-[0.8125rem] font-medium text-muted-foreground">
            {snapshot.customerDetails.email}
          </p>
        ) : (
          <p className="mt-1 text-[0.8125rem] font-medium text-muted-foreground">
            Loading contact…
          </p>
        )}
      </header>

      <section aria-label="Appointment schedule" className="mt-5">
        <p className="text-[0.9375rem] leading-5 font-semibold text-foreground">
          {values.scheduledTime}
        </p>
        <p className="mt-0.5 text-[0.8125rem] leading-5 text-muted-foreground">
          {serviceNames || 'Appointment'}
        </p>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
          with {snapshot.assignedProvider.displayName}
        </p>
      </section>

      <section
        aria-label="Appointment total"
        className="mt-4 rounded-[1.25rem] bg-muted/70 p-3.5"
      >
        <div className="flex items-start justify-between gap-5">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Services</p>
            <ul className="mt-1.5 grid gap-1">
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
            <p className="mt-1.5 text-xl leading-none font-bold tracking-tight tabular-nums">
              {values.quotedTotal}
            </p>
          </div>
        </div>
        <div
          data-mobile-task-expanded-only="true"
          className="mt-3 flex items-center justify-between border-t border-border/65 pt-3 text-xs"
        >
          <span className="text-muted-foreground">Provider preference</span>
          <span className="max-w-[60%] truncate text-right font-semibold text-foreground">
            {values.providerPreference}
          </span>
        </div>
      </section>

      <section
        data-mobile-task-expanded-only="true"
        aria-label="Customer contact"
        className="mt-4 border-y border-border/60 py-3"
      >
        <p className="text-[0.6875rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          Customer contact
        </p>
        <div className="mt-2 grid gap-1 text-sm font-medium">
          {contactActionsEnabled ? (
            <>
              {snapshot.customerDetails.phone ? (
                <a href={`tel:${snapshot.customerDetails.phone}`}>
                  {snapshot.customerDetails.phone}
                </a>
              ) : (
                <span className="text-muted-foreground">No phone number</span>
              )}
              <a href={`mailto:${snapshot.customerDetails.email}`}>
                {snapshot.customerDetails.email}
              </a>
            </>
          ) : (
            <span className="text-muted-foreground">Loading contact…</span>
          )}
        </div>
      </section>

      {contactActionsEnabled ? (
        <AppointmentOperationsPanel appointment={appointment} />
      ) : null}

      <nav
        aria-label="Appointment actions"
        className="sticky bottom-0 z-10 mt-auto grid grid-cols-3 gap-2 bg-background pt-4 pb-1"
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
    'flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-[1.2rem] px-2 text-center transition-transform active:scale-[0.97]',
    primary ? 'bg-primary text-primary-foreground' : 'bg-muted/75 text-foreground',
    disabled ? 'pointer-events-none opacity-40' : ''
  ].join(' ')
  const content = (
    <>
      <Icon aria-hidden className="size-[1.125rem]" strokeWidth={2.25} />
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
