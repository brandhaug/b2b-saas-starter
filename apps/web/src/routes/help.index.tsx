import { createFileRoute } from '@tanstack/react-router'
import { PublicLayout } from '@/components/public-layout'
import { SupportPage } from '@/components/support-page'
import { loadSupportConfig } from '@/lib/support-config'
import { m } from '@b2b-saas-starter/i18n/messages'

export const Route = createFileRoute('/help/')({
  loader: () => loadSupportConfig(),
  component: HelpPage,
  head: () => ({ meta: [{ title: m.public_meta_support() }] })
})

function HelpPage() {
  return (
    <PublicLayout>
      <SupportPage config={Route.useLoaderData()} />
    </PublicLayout>
  )
}
