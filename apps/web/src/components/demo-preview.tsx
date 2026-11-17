import { lazy, Suspense } from 'react'
import { DemoPreviewFrame } from '@/components/demo-renderer'
import { defaultDemoDataset, type DemoSection } from '@/lib/demo-fixtures'

function loadDemoStressPreview() {
  return import('@/components/demo-stress-preview')
}

// Development builds add the stress-data toggle; production builds drop this
// branch, so neither the toggle nor its fixtures reach the shipped bundle.
const DemoStressPreview = import.meta.env.DEV ? lazy(loadDemoStressPreview) : null

export function DemoPreview({ section }: { readonly section: DemoSection }) {
  const preview = <DemoPreviewFrame section={section} dataset={defaultDemoDataset} />
  if (DemoStressPreview === null) {
    return preview
  }
  return (
    <Suspense fallback={preview}>
      <DemoStressPreview section={section} />
    </Suspense>
  )
}
