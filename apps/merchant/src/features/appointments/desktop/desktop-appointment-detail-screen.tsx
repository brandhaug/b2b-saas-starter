import type { OperationalAppointment } from '@b2b-saas-starter/capabilities/booking'
import { appointmentDetailValues } from '../shared/appointment-detail-values.ts'

export function DesktopAppointmentDetailScreen({
  appointment
}: {
  readonly appointment: OperationalAppointment
}) {
  const snapshot = appointment.snapshot
  const values = appointmentDetailValues(appointment)
  return (
    <>
      <dl className="mt-8 grid gap-5 border bg-card p-6 sm:grid-cols-2">
        <Fact label="Status" value={values.status} />
        <Fact label="Scheduled time" value={values.scheduledTime} />
        <Fact label="Provider preference" value={values.providerPreference} />
        <Fact
          label="Assigned Provider snapshot"
          value={snapshot.assignedProvider.displayName}
        />
        <Fact label="Customer" value={snapshot.customerDetails.name} />
        <Fact label="Email" value={snapshot.customerDetails.email} />
        <Fact label="Phone" value={snapshot.customerDetails.phone ?? 'Not provided'} />
        <Fact label="Quoted total" value={values.quotedTotal} />
        <Fact label="Checkout path" value="Pay In Person" />
      </dl>
      <section className="mt-6 border bg-card p-6">
        <h2 className="font-semibold">Service snapshots</h2>
        <ul className="mt-4 divide-y border-y">
          {snapshot.services.map((service) => (
            <li
              key={`${service.role}-${service.id}`}
              className="flex justify-between gap-4 py-3 text-sm"
            >
              <span>
                <span className="font-medium">{service.name}</span>
                <span className="ml-2 capitalize text-muted-foreground">
                  {service.role}
                </span>
              </span>
              <span>
                {service.durationMinutes} min · {(service.priceMinor / 100).toFixed(2)}{' '}
                {service.currency}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}

function Fact({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium capitalize">{value}</dd>
    </div>
  )
}
