import { createFileRoute, Link } from '@tanstack/react-router'
import { OperationsShell } from '@/components/operations-shell.tsx'
import { formatAppointmentTime } from '@/lib/appointment-format.ts'
import { getAppointmentCalendar } from '@/lib/server/appointment-operations.ts'
import { requireMerchantSession } from '@/lib/server/merchant-session.ts'

export const Route = createFileRoute('/appointments')({
  beforeLoad: async ({ location }) => requireMerchantSession(location.href),
  validateSearch: (search: Record<string, unknown>) => ({
    date: typeof search.date === 'string' ? search.date : undefined
  }),
  loaderDeps: ({ search }) => ({ date: search.date }),
  loader: ({ deps }) => getAppointmentCalendar({ data: deps }),
  component: AppointmentsPage
})

function AppointmentsPage() {
  const calendar = Route.useLoaderData()
  const { date } = Route.useSearch()
  return (
    <OperationsShell
      title="Appointments"
      description="Your returning-user home: a Provider-oriented day view of accepted Appointment facts."
    >
      <form className="mt-6 flex items-end gap-3" method="get">
        <label className="grid gap-1.5 text-sm">
          Day in {calendar.timezone}
          <input
            className="h-9 rounded-md border bg-card px-3"
            type="date"
            name="date"
            defaultValue={date ?? calendar.date}
          />
        </label>
        <button
          className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
          type="submit"
        >
          View day
        </button>
      </form>
      {calendar.providers.length === 0 ? (
        <div className="mt-8 border bg-card p-8 text-center">
          <p className="font-medium">No Appointments this day</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Confirmed Appointments will appear here automatically.
          </p>
        </div>
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
                    className="grid gap-2 px-5 py-4 hover:bg-muted sm:grid-cols-[9rem_1fr_auto]"
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
    </OperationsShell>
  )
}
