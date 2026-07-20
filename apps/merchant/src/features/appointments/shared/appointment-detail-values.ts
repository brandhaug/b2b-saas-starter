import type { OperationalAppointment } from '@b2b-saas-starter/capabilities/booking'
import {
  formatAppointmentDateTime,
  formatAppointmentTime
} from '@/lib/appointment-format.ts'

export function appointmentDetailValues(appointment: OperationalAppointment) {
  const snapshot = appointment.snapshot
  return {
    status: appointment.status.replace('_', ' '),
    scheduledTime: `${formatAppointmentDateTime(appointment.startsAt, snapshot.merchantTimezone)} – ${formatAppointmentTime(appointment.endsAt, snapshot.merchantTimezone)}`,
    providerPreference:
      snapshot.providerPreference.kind === 'any'
        ? 'Any Provider'
        : `Specific Provider · ${snapshot.assignedProvider.displayName}`,
    quotedTotal: new Intl.NumberFormat('en', {
      style: 'currency',
      currency: snapshot.currency
    }).format(snapshot.totalMinor / 100)
  }
}
