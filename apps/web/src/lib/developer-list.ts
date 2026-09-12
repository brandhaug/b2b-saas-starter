import { useWorkspaceView, type WorkspaceView } from '@/lib/workspace-view'

export function useDeveloperListView({
  filters,
  sorts,
  defaultFilter,
  defaultSort,
  pageSize = 20
}: {
  readonly filters: ReadonlyArray<string>
  readonly sorts: ReadonlyArray<string>
  readonly defaultFilter: string
  readonly defaultSort: string
  readonly pageSize?: number
}) {
  const { view, update } = useWorkspaceView()
  const requestedPage = Number(view.page)
  const validPage =
    Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1

  function updateView(change: WorkspaceView, replace = false) {
    update(change, replace)
  }

  return {
    query: view.query ?? '',
    filter: filters.find((candidate) => candidate === view.filter) ?? defaultFilter,
    sort: sorts.find((candidate) => candidate === view.sort) ?? defaultSort,
    pageFor(itemCount: number) {
      const pageCount = Math.max(1, Math.ceil(itemCount / pageSize))
      return { page: Math.min(validPage, pageCount), pageCount }
    },
    pageSize,
    updateView
  }
}
