import { AppointmentRow, type AppointmentRowEntry } from '../shared/appointment-row.tsx'

export function DesktopAppointmentRow({
  appointment,
  date
}: {
  readonly appointment: AppointmentRowEntry
  readonly date: string
}) {
  return <AppointmentRow appointment={appointment} date={date} density="compact" />
}
