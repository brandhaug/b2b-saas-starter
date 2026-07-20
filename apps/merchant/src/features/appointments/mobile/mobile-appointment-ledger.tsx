import type { ProviderCalendar } from '@b2b-saas-starter/capabilities/booking'
import { EmptyAppointmentDay } from '../shared/empty-appointment-day.tsx'
import { MobileAppointmentRow } from './mobile-appointment-row.tsx'
import { mobileAppointmentLedger } from './mobile-appointments-model.ts'

export function MobileAppointmentLedger({
  calendar
}: {
  readonly calendar: ProviderCalendar
}) {
  const appointments = mobileAppointmentLedger(calendar.providers, calendar.timezone)
  if (appointments.length === 0) return <EmptyAppointmentDay />

  return (
    <section className="mt-10" aria-label="Appointments for selected day">
      <div className="flex items-center justify-between gap-4 px-1">
        <h2 className="text-lg font-bold text-foreground">Schedule</h2>
        <span className="text-xs font-semibold text-muted-foreground">
          {appointments.length}{' '}
          {appointments.length === 1 ? 'Appointment' : 'Appointments'}
        </span>
      </div>
      <ol className="mt-2">
        {appointments.map((appointment) => (
          <MobileAppointmentRow
            key={appointment.id}
            appointment={appointment}
            date={calendar.date}
          />
        ))}
      </ol>
    </section>
  )
}
