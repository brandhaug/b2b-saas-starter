import { createFileRoute } from '@tanstack/react-router'
import { MerchantAdvancedSettings } from '@/components/merchant-advanced-settings.tsx'
import { MerchantSettingsDetailRoute } from '@/components/merchant-settings-detail-route.tsx'

export const Route = createFileRoute('/settings/advanced')({
  component: MerchantAdvancedSettingsRoute
})

function MerchantAdvancedSettingsRoute() {
  return (
    <MerchantSettingsDetailRoute id="advanced" title="Advanced">
      <MerchantAdvancedSettings />
    </MerchantSettingsDetailRoute>
  )
}
