import { createFileRoute } from '@tanstack/react-router'
import { MerchantSettingsDetailRoute } from '@/components/merchant-settings-detail-route.tsx'
import { MerchantSubscriptionPanel } from '@/components/merchant-subscription-panel.tsx'
import { getMerchantPlan } from '@/lib/server/merchant-catalog.ts'

export const Route = createFileRoute('/settings/subscription')({
  loader: () => getMerchantPlan(),
  component: MerchantSubscription
})

function MerchantSubscription() {
  const plan = Route.useLoaderData()

  return (
    <MerchantSettingsDetailRoute
      id="subscription"
      title="Subscription"
      contentRevision={plan}
    >
      <MerchantSubscriptionPanel plan={plan} />
    </MerchantSettingsDetailRoute>
  )
}
