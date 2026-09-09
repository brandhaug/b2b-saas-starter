import { createFileRoute, notFound } from '@tanstack/react-router'
import { DemoRenderer } from '@/components/demo-renderer'
import { PreviewProvider } from '@/components/preview-provider'
import { isDemoSection } from '@/lib/demo-fixtures'

export const Route = createFileRoute('/demo_/$section')({
  beforeLoad: ({ params }) => {
    if (!isDemoSection(params.section)) {
      throw notFound()
    }
  },
  component: DemoSectionRoute
})

function DemoSectionRoute() {
  const section = Route.useParams().section
  if (!isDemoSection(section)) {
    throw notFound()
  }
  return (
    <PreviewProvider>
      <DemoRenderer section={section} />
    </PreviewProvider>
  )
}
