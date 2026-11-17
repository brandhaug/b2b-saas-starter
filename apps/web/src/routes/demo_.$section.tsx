import { workspaceViewSearch } from '@/lib/workspace-view'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { DemoPreview } from '@/components/demo-preview'
import { isDemoSection } from '@/lib/demo-fixtures'

export const Route = createFileRoute('/demo_/$section')({
  validateSearch: workspaceViewSearch,
  // The guard narrows once and hands the section down as context; the
  // component reads a `DemoSection`, so there is no second check to keep in
  // step with this one.
  beforeLoad: ({ params }) => {
    if (!isDemoSection(params.section)) {
      throw notFound()
    }
    return { section: params.section }
  },
  component: DemoSectionRoute
})

function DemoSectionRoute() {
  const { section } = Route.useRouteContext()
  return <DemoPreview section={section} />
}
