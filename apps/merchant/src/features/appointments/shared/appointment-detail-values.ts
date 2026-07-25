import type { OperationalAppointment } from '@b2b-saas-starter/capabilities/booking'
import {
  formatAppointmentDateTime,
  formatAppointmentTime
} from '@/lib/appointment-format.ts'

const currencyFormatters = new Map<string, Intl.NumberFormat>()

const currencyFormatter = (currency: string) => {
  const existing = currencyFormatters.get(currency)
  if (existing) return existing
  const formatter = Intl.NumberFormat('en', {
    style: 'currency',
    currency
  })
  currencyFormatters.set(currency, formatter)
  return formatter
}

export function appointmentDetailValues(appointment: OperationalAppointment) {
  const snapshot = appointment.snapshot
  return {
    status: appointment.status.replace('_', ' '),
    scheduledTime: `${formatAppointmentDateTime(appointment.startsAt, snapshot.merchantTimezone)} – ${formatAppointmentTime(appointment.endsAt, snapshot.merchantTimezone)}`,
    providerPreference:
      snapshot.providerPreference.kind === 'any'
        ? 'Any Provider'
        : `Specific Provider · ${snapshot.assignedProvider.displayName}`,
    quotedTotal: currencyFormatter(snapshot.currency).format(snapshot.totalMinor / 100)
  }
}
