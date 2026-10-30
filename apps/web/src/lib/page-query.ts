import { queryOptions, type QueryKey } from '@tanstack/react-query'

/** Loaders use staleTime: 0 to refresh on router.invalidate(). Observers reuse
 * that read, including hydration, until the next route refresh. */
export function pageQueryOptions<T>(queryKey: QueryKey, queryFn: () => Promise<T>) {
  return queryOptions({ queryKey, queryFn, staleTime: Infinity, retry: false })
}
