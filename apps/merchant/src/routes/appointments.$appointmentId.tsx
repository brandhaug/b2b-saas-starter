import { createFileRoute, notFound } from '@tanstack/react-router'
import { OperationsShell } from '@/components/operations-shell.tsx'
import {
  formatAppointmentDateTime,
  formatAppointmentTime
} from '@/lib/appointment-format.ts'
import { getAppointmentDetail } from '@/lib/server/appointment-operations.ts'
import { requireMerchantSession } from '@/lib/server/merchant-session.ts'

export const Route = createFileRoute('/appointments/$appointmentId')({
  beforeLoad: async ({ location }) => requireMerchantSession(location.href),
  loader: async ({ params }) => {
    const result = await getAppointmentDetail({ data: params })
    if (result.kind === 'not_found') throw notFound()
    return result.appointment
  },
  component: AppointmentDetailPage
})

function AppointmentDetailPage() {
  const appointment = Route.useLoaderData()
  const snapshot = appointment.snapshot
  const money = new Intl.NumberFormat('en', {
    style: 'currency',
    currency: snapshot.currency
  }).format(snapshot.totalMinor / 100)
  return (
    <OperationsShell
      title="Appointment detail"
      description="An inspect-only record of the facts accepted when this Appointment was confirmed."
    >
      <dl className="mt-8 grid gap-5 border bg-card p-6 sm:grid-cols-2">
        <Fact label="Status" value={appointment.status.replace('_', ' ')} />
        <Fact
          label="Scheduled time"
          value={`${formatAppointmentDateTime(appointment.startsAt, snapshot.merchantTimezone)} – ${formatAppointmentTime(appointment.endsAt, snapshot.merchantTimezone)}`}
        />
        <Fact
          label="Provider preference"
          value={
            snapshot.providerPreference.kind === 'any'
              ? 'Any Provider'
              : `Specific Provider · ${snapshot.assignedProvider.displayName}`
          }
        />
        <Fact
          label="Assigned Provider snapshot"
          value={snapshot.assignedProvider.displayName}
        />
        <Fact label="Customer" value={snapshot.customerDetails.name} />
        <Fact label="Email" value={snapshot.customerDetails.email} />
        <Fact label="Phone" value={snapshot.customerDetails.phone ?? 'Not provided'} />
        <Fact label="Quoted total" value={money} />
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
    </OperationsShell>
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
