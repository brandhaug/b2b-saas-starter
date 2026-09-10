import { createFileRoute, notFound } from '@tanstack/react-router'
import { DemoRenderer } from '@/components/demo-renderer'
import { PreviewProvider } from '@/components/preview-provider'
import { isDemoSection } from '@/lib/demo-fixtures'

export const Route = createFileRoute('/demo_/$section')({
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
  return (
    <PreviewProvider>
      <DemoRenderer section={section} />
    </PreviewProvider>
  )
}
