import type { OperationalAppointment } from '@b2b-saas-starter/capabilities/booking'

const purposeLabel = {
  appointment_confirmation: 'Confirmation',
  appointment_reschedule: 'Reschedule',
  appointment_cancellation: 'Cancellation',
  appointment_reminder: 'Reminder'
} as const

const statusLabel = {
  pending: 'Pending',
  claimed: 'Pending',
  captured: 'Captured locally',
  accepted: 'Provider accepted',
  delivered: 'Delivered',
  failed: 'Delivery failed',
  suppressed: 'Not sent — Don’t Notify',
  unavailable: 'Not sent — unavailable',
  submission_unknown: 'Submission unknown',
  superseded: 'Not sent — superseded',
  superseded_after_submission: 'Superseded after submission'
} as const

export function AppointmentEmailDeliveryHistory({
  appointment,
  compact = false
}: {
  readonly appointment: OperationalAppointment
  readonly compact?: boolean
}) {
  const deliveries = appointment.emailDeliveries ?? []
  if (deliveries.length === 0) return null
  return (
    <section
      aria-label="Customer email delivery history"
      className={
        compact ? 'mt-4 border-y border-border/60 py-3' : 'mt-6 border bg-card p-6'
      }
    >
      <h2
        className={
          compact
            ? 'text-[0.6875rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase'
            : 'font-semibold'
        }
      >
        Customer email
      </h2>
      <ul className="mt-3 grid gap-2">
        {deliveries.map((delivery) => (
          <li
            key={delivery.id}
            className="flex items-start justify-between gap-4 text-xs"
          >
            <span>
              <span className="font-medium">{purposeLabel[delivery.purpose]}</span>
              <span className="ml-2 text-muted-foreground">
                {delivery.locale.toUpperCase()} ·{' '}
                {delivery.maskedDestination ?? 'No destination'}
              </span>
            </span>
            <span className="text-right font-medium">
              {statusLabel[delivery.status]}
              <span className="block font-normal text-muted-foreground">
                {delivery.deliveredAt ??
                  delivery.acceptedAt ??
                  delivery.lastAttemptAt ??
                  delivery.availableAt}
              </span>
              {delivery.reason ? (
                <span className="block font-normal text-muted-foreground">
                  {delivery.reason.replaceAll('_', ' ')}
                </span>
              ) : null}
              {delivery.underReview ? (
                <span className="block text-destructive">Needs attention</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
