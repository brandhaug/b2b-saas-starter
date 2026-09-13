import { useWorkspaceView } from '@/lib/workspace-view'
import { useTableView } from '@/lib/use-table-view'
import { type TableViewField } from '@/lib/table-view'

export function useDeveloperListView({
  key,
  fields,
  pageSize = 20
}: {
  readonly key?: string
  readonly fields?: ReadonlyArray<TableViewField>
  readonly pageSize?: number
}) {
  const { view } = useWorkspaceView()
  const table = useTableView(key ?? 'developer-list', fields ?? [])
  const requestedPage = Number(view.page)
  const validPage =
    Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1

  return {
    query: view.query ?? '',
    pageFor(itemCount: number) {
      const pageCount = Math.max(1, Math.ceil(itemCount / pageSize))
      return { page: Math.min(validPage, pageCount), pageCount }
    },
    pageSize,
    tableView: table.view,
    setTableView: table.setView
  }
}
