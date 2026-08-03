import { createFileRoute } from '@tanstack/react-router'
import { MerchantShell } from '@/components/merchant-shell/index.ts'
import { CustomerDirectoryWorkspace } from '@/features/customers/customer-directory-workspace.tsx'
import { searchCustomerRecords } from '@/lib/server/customer-directory.ts'
import { requireMerchantSession } from '@/lib/server/merchant-session.ts'

export const Route = createFileRoute('/customers')({
  beforeLoad: async ({ location }) => requireMerchantSession(location.href),
  loader: async () => ({
    entries: await searchCustomerRecords({
      data: { query: '' }
    })
  }),
  component: CustomersPage
})

function CustomersPage() {
  const directory = Route.useLoaderData()
  return (
    <MerchantShell
      section={{ kind: 'merchant' }}
      title="Customers"
      description="Merchant-scoped Customer Records with conservative contact matching and immutable Appointment history."
    >
      <CustomerDirectoryWorkspace initialRecords={directory.entries} />
    </MerchantShell>
  )
}
