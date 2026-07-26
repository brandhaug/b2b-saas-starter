import { createFileRoute, useLocation } from '@tanstack/react-router'
import { MerchantSettingsPanel } from '@/components/merchant-settings-panel.tsx'
import { MerchantShell } from '@/components/merchant-shell/index.ts'
import { useMerchantSignOut } from '@/hooks/use-merchant-sign-out.ts'
import { merchantHomeDate } from '@/lib/merchant-home-date.ts'
import { merchantViewerFromUser } from '@/lib/merchant-viewer.ts'
import { requireMerchantSession } from '@/lib/server/merchant-session.ts'

export const Route = createFileRoute('/settings')({
  beforeLoad: async ({ location }) => {
    const session = await requireMerchantSession(location.href)
    return { merchantViewer: merchantViewerFromUser(session.user) }
  },
  component: MerchantSettings
})

function MerchantSettings() {
  const { merchantViewer } = Route.useRouteContext()
  const location = useLocation()
  const signOut = useMerchantSignOut()
  const appointmentDate = merchantHomeDate(location.search, location.state)

  return (
    <MerchantShell
      section={{ kind: 'merchant' }}
      title="Settings"
      description="Manage your Merchant, presentation, and integrations."
      viewer={merchantViewer ?? undefined}
    >
      <MerchantSettingsPanel
        appointmentDate={appointmentDate}
        signOut={signOut}
        viewer={merchantViewer ?? undefined}
      />
    </MerchantShell>
  )
}
