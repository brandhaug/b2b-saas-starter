import { lazy, Suspense } from 'react'
import { DemoRenderer } from '@/components/demo-renderer'
import { PreviewProvider } from '@/components/preview-provider'
import { defaultDemoDataset, type DemoSection } from '@/lib/demo-fixtures'

// Development builds add the stress-data toggle; production builds drop this
// branch, so neither the toggle nor its fixtures reach the shipped bundle.
function loadDemoStressPreview() {
  return import('@/components/demo-stress-preview')
}
const DemoStressPreview = import.meta.env.DEV ? lazy(loadDemoStressPreview) : null

export function DemoPreview({ section }: { readonly section: DemoSection }) {
  const preview = (
    <PreviewProvider>
      <DemoRenderer section={section} dataset={defaultDemoDataset} />
    </PreviewProvider>
  )
  if (DemoStressPreview === null) {
    return preview
  }
  return (
    <Suspense fallback={preview}>
      <DemoStressPreview section={section} />
    </Suspense>
  )
}
