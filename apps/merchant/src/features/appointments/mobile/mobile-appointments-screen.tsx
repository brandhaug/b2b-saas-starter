import { Link } from '@tanstack/react-router'
import type { ProviderCalendar } from '@b2b-saas-starter/capabilities/booking'
import { formatAppointmentTime } from '@/lib/appointment-format.ts'
import { AppointmentDayPicker } from '../shared/appointment-day-picker.tsx'
import { EmptyAppointmentDay } from '../shared/empty-appointment-day.tsx'

export function MobileAppointmentsScreen({
  calendar,
  selectedDate
}: {
  readonly calendar: ProviderCalendar
  readonly selectedDate: string | undefined
}) {
  return (
    <>
      <AppointmentDayPicker
        date={selectedDate ?? calendar.date}
        timezone={calendar.timezone}
        presentation="mobile"
      />
      {calendar.providers.length === 0 ? (
        <EmptyAppointmentDay />
      ) : (
        <div className="mt-6 grid gap-6">
          {calendar.providers.map((group) => (
            <section key={group.provider.id}>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
                {group.provider.displayName}
              </h2>
              <div className="grid gap-3">
                {group.appointments.map((appointment) => (
                  <Link
                    key={appointment.id}
                    to="/appointments/$appointmentId"
                    params={{ appointmentId: appointment.id }}
                    search={{ date: calendar.date }}
                    className="rounded-xl border bg-card p-4 shadow-sm active:bg-muted"
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span className="font-semibold">
                        {appointment.snapshot.customerDetails.name}
                      </span>
                      <span className="rounded-full bg-secondary px-2 py-1 text-xs capitalize text-secondary-foreground">
                        {appointment.status.replace('_', ' ')}
                      </span>
                    </span>
                    <span className="mt-3 block font-mono text-lg">
                      {formatAppointmentTime(appointment.startsAt, calendar.timezone)}
                    </span>
                    <span className="mt-1 block text-sm text-muted-foreground">
                      {appointment.snapshot.services
                        .map((service) => service.name)
                        .join(', ')}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  )
}
