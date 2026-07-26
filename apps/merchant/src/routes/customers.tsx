import { createFileRoute } from '@tanstack/react-router'
import {
  MerchantPresentationBoundary,
  MerchantShell
} from '@/components/merchant-shell/index.ts'
import { DesktopCustomerContactList } from '@/features/customers/desktop-customer-contact-list.tsx'
import { MobileCustomerContactList } from '@/features/customers/mobile-customer-contact-list.tsx'
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
        desktop={<DesktopCustomerContactList directory={directory} />}
      />
    </MerchantShell>
  )
}
