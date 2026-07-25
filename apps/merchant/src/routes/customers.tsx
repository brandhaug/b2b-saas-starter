import { createFileRoute, Link } from '@tanstack/react-router'
import type { CustomerDirectory } from '@b2b-saas-starter/capabilities/booking'
import {
  MerchantPresentationBoundary,
  MerchantShell
} from '@/components/merchant-shell/index.ts'
import { mobileSheetNavigationState } from '@/components/merchant-shell/mobile/mobile-sheet-gesture.ts'
import { MobileCustomerContactList } from '@/features/customers/mobile-customer-contact-list.tsx'
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
    <MerchantShell
      section={{ kind: 'merchant' }}
      title="Customers"
      description="One captured Customer Details entry per Appointment. Matching contact details are not merged into identities."
    >
      <MerchantPresentationBoundary
        mobile={<MobileCustomerContactList directory={directory} />}
        desktop={<DesktopCustomerDirectory directory={directory} />}
      />
    </MerchantShell>
  )
}

function DesktopCustomerDirectory({
  directory
}: {
  readonly directory: CustomerDirectory
}) {
  if (directory.entries.length === 0)
    return (
      <div className="mt-8 border bg-card p-8 text-center text-sm text-muted-foreground">
        No Customer Details have been captured yet.
      </div>
    )

  return (
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
                  className="text-foreground underline underline-offset-4 hover:text-muted-foreground"
                  to="/appointments/$appointmentId"
                  viewTransition={false}
                  state={mobileSheetNavigationState}
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
  )
}
