import { createFileRoute } from '@tanstack/react-router'
import {
  MerchantMessagingSettingsLoadError,
  MerchantMessagingSettingsLoading,
  MerchantMessagingSettingsPanel
} from '@/components/merchant-messaging-settings-panel.tsx'
import { MerchantSettingsDetailRoute } from '@/components/merchant-settings-detail-route.tsx'
import {
  getMerchantMessagingSettings,
  saveMerchantMessagingSettings
} from '@/lib/server/merchant-messaging.ts'

export const Route = createFileRoute('/settings/appointment-messaging')({
  loader: () => getMerchantMessagingSettings(),
  pendingComponent: MerchantAppointmentMessagingPending,
  errorComponent: MerchantAppointmentMessagingError,
  component: MerchantAppointmentMessaging
})

export function MerchantAppointmentMessagingPending() {
  return (
    <MerchantSettingsDetailRoute
      id="appointment-messaging-loading"
      title="Appointment messaging"
    >
      <MerchantMessagingSettingsLoading />
    </MerchantSettingsDetailRoute>
  )
}

export function MerchantAppointmentMessagingError() {
  return (
    <MerchantSettingsDetailRoute
      id="appointment-messaging-error"
      title="Appointment messaging"
    >
      <MerchantMessagingSettingsLoadError />
    </MerchantSettingsDetailRoute>
  )
}

function MerchantAppointmentMessaging() {
  const settings = Route.useLoaderData()
  return (
    <MerchantSettingsDetailRoute
      id="appointment-messaging"
      title="Appointment messaging"
      contentRevision={`${settings.enabled}:${settings.reminderLeadHours}`}
    >
      <MerchantMessagingSettingsPanel
        initial={settings}
        save={(data) => saveMerchantMessagingSettings({ data })}
      />
    </MerchantSettingsDetailRoute>
  )
}
