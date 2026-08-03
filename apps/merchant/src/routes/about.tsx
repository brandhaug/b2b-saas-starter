import { createFileRoute } from '@tanstack/react-router'
import { MerchantAbout } from '@/components/merchant-about.tsx'
import { MerchantShell } from '@/components/merchant-shell/index.ts'
import { requireMerchantSession } from '@/lib/server/merchant-session.ts'

export const Route = createFileRoute('/about')({
  beforeLoad: async ({ location }) => requireMerchantSession(location.href),
  component: AboutPage
})

function AboutPage() {
  return (
    <MerchantShell
      section={{ kind: 'merchant' }}
      title="About"
      description="About the BeeSolo Merchant App."
    >
      <MerchantAbout />
    </MerchantShell>
  )
}
