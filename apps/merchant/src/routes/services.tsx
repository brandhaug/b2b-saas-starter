import { createFileRoute } from '@tanstack/react-router'
import { ServicesPage } from '@/features/services/services-page.tsx'
import { getMerchantCatalog } from '@/lib/server/merchant-catalog.ts'
import { requireMerchantSession } from '@/lib/server/merchant-session.ts'

export const Route = createFileRoute('/services')({
  beforeLoad: async ({ location }) => requireMerchantSession(location.href),
  loader: () => getMerchantCatalog(),
  component: ServicesRoute
})

function ServicesRoute() {
  return <ServicesPage catalog={Route.useLoaderData()} />
}
