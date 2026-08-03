import { createFileRoute } from '@tanstack/react-router'
import { MerchantSettingsDetailRoute } from '@/components/merchant-settings-detail-route.tsx'
import { MerchantThemeControl } from '@/components/merchant-theme-control.tsx'

export const Route = createFileRoute('/settings/appearance')({
  component: MerchantAppearanceSettings
})

function MerchantAppearanceSettings() {
  return (
    <MerchantSettingsDetailRoute id="appearance" title="Appearance">
      <div className="[&>fieldset]:mt-0">
        <MerchantThemeControl />
      </div>
    </MerchantSettingsDetailRoute>
  )
}
