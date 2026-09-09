import { createFileRoute } from '@tanstack/react-router'
import { pageTitle } from '@/components/page/page-title'
import { PreviewProvider } from '@/components/preview-provider'
import { DEMO_WORKSPACE_SLUG } from '@/lib/demo-workspace'
import { DemoRenderer } from '@/components/demo-renderer'
import { m } from '@b2b-saas-starter/i18n/messages'

export const Route = createFileRoute('/demo')({
  component: () => (
    <PreviewProvider>
      <DemoRenderer section="overview" />
    </PreviewProvider>
  ),
  head: () => ({
    meta: [{ title: pageTitle(m.public_meta_demo(), DEMO_WORKSPACE_SLUG) }]
  })
})
