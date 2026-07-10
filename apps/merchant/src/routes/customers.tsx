import { createFileRoute, Link } from '@tanstack/react-router'
import { OperationsShell } from '@/components/operations-shell.tsx'
import { formatAppointmentDateTime } from '@/lib/appointment-format.ts'
import { getCustomerDirectory } from '@/lib/server/appointment-operations.ts'
import { requireMerchantSession } from '@/lib/server/merchant-session.ts'

export const Route = createFileRoute('/customers')({
  beforeLoad: async ({ location }) => requireMerchantSession(location.href),
  loader: () => getCustomerDirectory(),
  component: CustomersPage
})

function CustomersPage() {
  const directory = Route.useLoaderData()
  return (
    <OperationsShell
      title="Customers"
      description="One captured Customer Details entry per Appointment. Matching contact details are not merged into identities."
    >
      {directory.entries.length === 0 ? (
        <div className="mt-8 border bg-card p-8 text-center text-sm text-muted-foreground">
          No Customer Details have been captured yet.
        </div>
      ) : (
        <div className="mt-8 overflow-x-auto border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted text-xs text-muted-foreground">
              <tr>
                <th className="p-4">Customer Details</th>
                <th className="p-4">Contact</th>
                <th className="p-4">Appointment</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {directory.entries.map((entry) => (
                <tr key={entry.appointmentId}>
                  <td className="p-4 font-medium">{entry.name}</td>
                  <td className="p-4">
                    <span className="block">{entry.email}</span>
                    <span className="text-muted-foreground">
                      {entry.phone ?? 'No phone'}
                    </span>
                  </td>
                  <td className="p-4">
                    <Link
                      className="text-primary underline underline-offset-4"
                      to="/appointments/$appointmentId"
                      params={{ appointmentId: entry.appointmentId }}
                      search={{ date: entry.scheduledAt.slice(0, 10) }}
                    >
                      {formatAppointmentDateTime(entry.scheduledAt, directory.timezone)}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </OperationsShell>
  )
}
