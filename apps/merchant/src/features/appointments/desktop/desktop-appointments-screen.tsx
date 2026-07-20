import { Link } from '@tanstack/react-router'
import type { ProviderCalendar } from '@b2b-saas-starter/capabilities/booking'
import { formatAppointmentTime } from '@/lib/appointment-format.ts'
import { AppointmentDayPicker } from '../shared/appointment-day-picker.tsx'
import { EmptyAppointmentDay } from '../shared/empty-appointment-day.tsx'

export function DesktopAppointmentsScreen({
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
        presentation="desktop"
      />
      {calendar.providers.length === 0 ? (
        <EmptyAppointmentDay />
      ) : (
        <div className="mt-8 grid gap-6">
          {calendar.providers.map((group) => (
            <section key={group.provider.id} className="border bg-card">
              <h2 className="border-b px-5 py-4 font-semibold">
                {group.provider.displayName}
              </h2>
              <div className="divide-y">
                {group.appointments.map((appointment) => (
                  <Link
                    key={appointment.id}
                    to="/appointments/$appointmentId"
                    params={{ appointmentId: appointment.id }}
                    search={{ date: calendar.date }}
                    className="grid grid-cols-[9rem_1fr_auto] gap-2 px-5 py-4 hover:bg-muted"
                  >
                    <span className="font-mono text-sm">
                      {formatAppointmentTime(appointment.startsAt, calendar.timezone)}
                    </span>
                    <span className="text-sm font-medium">
                      {appointment.snapshot.customerDetails.name}
                    </span>
                    <span className="text-xs capitalize text-muted-foreground">
                      {appointment.status.replace('_', ' ')}
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
