import { Skeleton } from '@/components/ui/skeleton'

/**
 * Shared `pendingComponent` for capability-backed routes: a skeleton in the
 * exact shape every workspace page renders — a breadcrumb line, the page
 * header, then one stacked panel. The shell already centers the column, so
 * this carries no width of its own (semantic tokens only, per DESIGN.md).
 */
export function RoutePending() {
  return (
    <output className="grid w-full gap-6" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="grid gap-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-4 rounded-none border border-border bg-card p-4 sm:p-6">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-40 w-full" />
      </div>
    </output>
  )
}
