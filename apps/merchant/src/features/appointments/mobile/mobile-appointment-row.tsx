import { AppointmentRow } from '../shared/appointment-row.tsx'
import type { MobileAppointmentLedgerEntry } from './mobile-appointments-model.ts'

export function MobileAppointmentRow({
  appointment,
  date
}: {
  readonly appointment: MobileAppointmentLedgerEntry
  readonly date: string
}) {
  return <AppointmentRow appointment={appointment} date={date} density="comfortable" />
}
