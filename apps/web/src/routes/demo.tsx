import { workspaceViewSearch } from '@/lib/workspace-view'
import { createFileRoute } from '@tanstack/react-router'
import { pageTitle } from '@/components/page/page-title'
import { DemoPreview } from '@/components/demo-preview'
import { DEMO_WORKSPACE_SLUG } from '@/lib/demo-workspace'
import { m } from '@b2b-saas-starter/i18n/messages'

export const Route = createFileRoute('/demo')({
  validateSearch: workspaceViewSearch,
  component: () => <DemoPreview section="overview" />,
  head: () => ({
    meta: [{ title: pageTitle(m.public_meta_demo(), DEMO_WORKSPACE_SLUG) }]
  })
})
