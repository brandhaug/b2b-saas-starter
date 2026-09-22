import { useNavigate } from '@tanstack/react-router'

import { useWorkspaceView } from '@/lib/workspace-view'
import { updateTableViews, useTableView } from '@/lib/use-table-view'
import { applyTableView, defaultTableView, type TableViewField } from '@/lib/table-view'

export function useDeveloperListView<T>({
  key,
  fields,
  data,
  searchText,
  getValue,
  pageSize = 20
}: {
  readonly key: string
  readonly fields: ReadonlyArray<TableViewField>
  readonly data: ReadonlyArray<T>
  readonly searchText: (row: T) => string
  readonly getValue: (
    row: T,
    field: string
  ) => string | number | boolean | Date | null | undefined
  readonly pageSize?: number
}) {
  const { view, update } = useWorkspaceView()
  const navigate = useNavigate()
  const table = useTableView(key, fields)
  const query = view.query ?? ''
  const needle = query.trim().toLocaleLowerCase()
  const searched =
    needle === ''
      ? data
      : data.filter((row) => searchText(row).toLocaleLowerCase().includes(needle))
  const filtered = applyTableView(searched, table.view, getValue)
  const requestedPage = Number(view.page)
  const validPage =
    Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const page = Math.min(validPage, pageCount)

  function setQuery(nextQuery: string) {
    update({ query: nextQuery || undefined, page: undefined }, true)
  }
  function setPage(nextPage: number) {
    update({ page: nextPage <= 1 ? undefined : String(nextPage) })
  }
  function clear() {
    void navigate({
      to: '.',
      search: (previous) => ({
        ...previous,
        query: undefined,
        page: undefined,
        tableViews: updateTableViews(previous.tableViews, key, defaultTableView)
      }),
      resetScroll: false
    })
  }

  return {
    query,
    page,
    pageCount,
    visibleData: filtered.slice((page - 1) * pageSize, page * pageSize),
    tableView: table.view,
    setTableView: table.setView,
    setQuery,
    setPage,
    clear
  }
}
