import { Skeleton } from '@/components/ui/skeleton'

/**
 * Shared `pendingComponent` for capability-backed routes: a quiet card-shaped
 * skeleton matching the workspace layout rhythm (semantic tokens only, per
 * DESIGN.md).
 */
export function RoutePending() {
  return (
    <output
      className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-10 sm:px-6"
      aria-label="Loading"
    >
      <div className="grid gap-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Skeleton className="h-72" />
        <div className="grid gap-6">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      </div>
    </output>
  )
}
