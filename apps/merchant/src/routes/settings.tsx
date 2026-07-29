import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router'
import { MerchantSettingsPanel } from '@/components/merchant-settings-panel.tsx'
import { MerchantShell } from '@/components/merchant-shell/index.ts'
import { MerchantPresentationBoundary } from '@/components/merchant-shell/merchant-presentation.tsx'
import { useMerchantSignOut } from '@/hooks/use-merchant-sign-out.ts'
import { merchantHomeDate } from '@/lib/merchant-home-date.ts'
import { merchantViewerFromUser } from '@/lib/merchant-viewer.ts'
import { requireMerchantSession } from '@/lib/server/merchant-session.ts'
import { canManageMerchantMessaging } from '@/lib/server/merchant-messaging.ts'

export const Route = createFileRoute('/settings')({
  beforeLoad: async ({ location }) => {
    const session = await requireMerchantSession(location.href)
    return {
      merchantViewer: merchantViewerFromUser(session.user),
      canManageMessaging: await canManageMerchantMessaging()
    }
  },
  component: MerchantSettings
})

function MerchantSettings() {
  const { merchantViewer, canManageMessaging } = Route.useRouteContext()
  const location = useLocation()
  const signOut = useMerchantSignOut()
  const appointmentDate = merchantHomeDate(location.search, location.state)
  const settingsPanel = (
    <MerchantSettingsPanel
      appointmentDate={appointmentDate}
      canManageMessaging={canManageMessaging}
      signOut={signOut}
      viewer={merchantViewer ?? undefined}
    />
  )

  return (
    <MerchantShell
      section={{ kind: 'merchant' }}
      title="Settings"
      description="Manage your Merchant, presentation, and integrations."
      viewer={merchantViewer ?? undefined}
    >
      <MerchantPresentationBoundary
        desktop={
          <>
            {settingsPanel}
            <Outlet />
          </>
        }
        mobile={location.pathname.startsWith('/settings/') ? <Outlet /> : settingsPanel}
      />
    </MerchantShell>
  )
}
