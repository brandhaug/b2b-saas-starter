import type { OperationalAppointment } from '@b2b-saas-starter/capabilities/booking'
import { appointmentDetailValues } from '../shared/appointment-detail-values.ts'

export function MobileAppointmentDetailScreen({
  appointment
}: {
  readonly appointment: OperationalAppointment
}) {
  const snapshot = appointment.snapshot
  const values = appointmentDetailValues(appointment)
  return (
    <div className="mt-6 grid gap-4">
      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-lg font-semibold">{snapshot.customerDetails.name}</p>
            <p className="mt-1 text-sm text-muted-foreground">{values.scheduledTime}</p>
          </div>
          <span className="rounded-full bg-secondary px-2 py-1 text-xs capitalize text-secondary-foreground">
            {values.status}
          </span>
        </div>
        <dl className="mt-5 grid gap-4 border-t pt-4">
          <MobileFact label="Provider" value={snapshot.assignedProvider.displayName} />
          <MobileFact label="Preference" value={values.providerPreference} />
          <MobileFact label="Quoted total" value={values.quotedTotal} />
        </dl>
      </section>
      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-semibold">Contact</h2>
        <a
          className="mt-4 block text-sm font-medium text-foreground underline underline-offset-4"
          href={`mailto:${snapshot.customerDetails.email}`}
        >
          {snapshot.customerDetails.email}
        </a>
        {snapshot.customerDetails.phone ? (
          <a
            className="mt-3 block text-sm font-medium text-foreground underline underline-offset-4"
            href={`tel:${snapshot.customerDetails.phone}`}
          >
            {snapshot.customerDetails.phone}
          </a>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No phone provided</p>
        )}
      </section>
      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-semibold">Services</h2>
        <ul className="mt-3 grid gap-3">
          {snapshot.services.map((service) => (
            <li key={`${service.role}-${service.id}`} className="border-t pt-3">
              <p className="font-medium">{service.name}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {service.durationMinutes} min · {(service.priceMinor / 100).toFixed(2)}{' '}
                {service.currency}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function MobileFact({
  label,
  value
}: {
  readonly label: string
  readonly value: string
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm font-medium">{value}</dd>
    </div>
  )
}
