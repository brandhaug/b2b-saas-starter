import { createFileRoute } from '@tanstack/react-router'
import { MerchantSettingsDetailRoute } from '@/components/merchant-settings-detail-route.tsx'
import { MerchantSubscriptionPanel } from '@/components/merchant-subscription-panel.tsx'
import {
  cancelSoloAtPeriodEnd,
  getOwnerBilling,
  openBillingPortal,
  scheduleSoloIntervalChange,
  startSoloCheckout,
  undoSoloCancellation
} from '@/lib/server/merchant-subscription.ts'

export const Route = createFileRoute('/settings/subscription')({
  loader: () => getOwnerBilling(),
  component: MerchantSubscription
})

function MerchantSubscription() {
  const subscription = Route.useLoaderData()
  const key = () => crypto.randomUUID()
  const manageBilling = async () => {
    const result = subscription.providerCustomerRef
      ? await openBillingPortal({ data: { idempotencyKey: key() } })
      : await startSoloCheckout({
          data: { interval: subscription.interval, idempotencyKey: key() }
        })
    window.location.assign(result.url)
  }
  const toggleCancellation = async () => {
    if (subscription.cancelAtPeriodEnd)
      await undoSoloCancellation({ data: { idempotencyKey: key() } })
    else await cancelSoloAtPeriodEnd({ data: { idempotencyKey: key() } })
  }
  const switchInterval = async () => {
    await scheduleSoloIntervalChange({
      data: {
        interval: subscription.interval === 'monthly' ? 'annual' : 'monthly',
        idempotencyKey: key()
      }
    })
  }

  return (
    <MerchantSettingsDetailRoute
      id="subscription"
      title="Subscription"
      contentRevision={`${subscription.revision}:${subscription.access}`}
    >
      <MerchantSubscriptionPanel
        plan="solo"
        subscription={subscription}
        onManageBilling={manageBilling}
        onToggleCancellation={toggleCancellation}
        onSwitchInterval={switchInterval}
      />
    </MerchantSettingsDetailRoute>
  )
}
