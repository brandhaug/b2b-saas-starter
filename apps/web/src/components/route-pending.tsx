import { Panel } from '@/components/page/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { m } from '@b2b-saas-starter/i18n/messages'

/**
 * Shared `pendingComponent` for capability-backed routes: a skeleton in the
 * exact shape every workspace page renders — a breadcrumb line, the page
 * header, then one stacked panel. The shell already centers the column, so
 * this carries no width of its own (semantic tokens only, per DESIGN.md).
 */
export function RoutePending() {
  return (
    <output className="grid w-full gap-6" aria-live="polite">
      <span className="sr-only">{m.common_loading()}</span>
      <div className="grid gap-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      {/* The real page renders a Panel here, so the skeleton renders one too
          instead of a second copy of the panel surface. */}
      <Panel>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-40 w-full" />
      </Panel>
    </output>
  )
}
