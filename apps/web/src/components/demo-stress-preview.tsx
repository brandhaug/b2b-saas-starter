import { useNavigate, useRouterState } from '@tanstack/react-router'
import { DemoPreviewFrame } from '@/components/demo-renderer'
import { Button } from '@/components/ui/button'
import { SegmentGroup } from '@/components/ui/segment-group'
import { defaultDemoDataset, type DemoSection } from '@/lib/demo-fixtures'
import {
  demoDataKindFromSearch,
  demoDataKinds,
  type DemoDataKind
} from '@/lib/demo-data-kind'
import { stressDatasets } from '@/lib/demo-stress-fixtures'

const labels: Record<DemoDataKind, string> = {
  demo: 'Demo data',
  worst: 'Worst case',
  empty: 'Empty',
  one: 'One',
  huge: '1,000 rows'
}

/**
 * Development-only `/demo` wrapper: swaps the preview's dataset at the fixture
 * boundary from `?data=` and pins a segmented control to the viewport. The
 * control is test chrome rather than product UI, so its labels stay English.
 */
export default function DemoStressPreview({
  section
}: {
  readonly section: DemoSection
}) {
  const kind = useRouterState({
    select: (state) => demoDataKindFromSearch(state.location.search)
  })
  const navigate = useNavigate()
  const dataset = kind === 'demo' ? defaultDemoDataset : stressDatasets[kind]
  return (
    <>
      <DemoPreviewFrame key={kind} section={section} dataset={dataset} />
      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex justify-center">
        <div className="pointer-events-auto max-w-full overflow-x-auto rounded-md bg-background shadow-md">
          <SegmentGroup
            aria-label="Preview dataset"
            className="flex-wrap justify-center"
          >
            {demoDataKinds.map((option) => (
              <Button
                key={option}
                variant="segment"
                aria-pressed={option === kind}
                onClick={() => {
                  void navigate({
                    to: '.',
                    search: (previous) => ({
                      ...previous,
                      data: option === 'demo' ? undefined : option
                    }),
                    replace: true,
                    resetScroll: false
                  })
                }}
              >
                {labels[option]}
              </Button>
            ))}
          </SegmentGroup>
        </div>
      </div>
    </>
  )
}
