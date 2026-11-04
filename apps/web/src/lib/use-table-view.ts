import { useNavigate, useRouterState } from '@tanstack/react-router'
import { Option, Schema } from 'effect'

import {
  parseTableView,
  serializeTableView,
  type TableView,
  type TableViewField
} from '@/lib/table-view'

const MAX_VIEWS = 24

type SerializedViews = Record<string, string>
const ViewsRecord = Schema.Record(Schema.String, Schema.Unknown)
const decodeViews = Schema.decodeUnknownOption(
  Schema.Union([
    ViewsRecord,
    Schema.String.check(Schema.isMaxLength(32_768)).pipe(
      Schema.decodeTo(Schema.fromJsonString(ViewsRecord))
    )
  ])
)
const isSerializedView = Schema.is(Schema.String)

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- URL input is decoded here before individual entries are retained
function readViews(value: unknown): SerializedViews {
  const decoded = decodeViews(value)
  if (Option.isNone(decoded)) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(decoded.value)
      .flatMap(([key, serialized]) =>
        key.length <= 128 && isSerializedView(serialized) ? [[key, serialized]] : []
      )
      .slice(0, MAX_VIEWS)
  )
}

/** Update one saved view while preserving the other lists' URL state. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- accepts the same URL boundary as readViews
export function updateTableViews(value: unknown, key: string, view: TableView) {
  const views = readViews(value)
  const serialized = serializeTableView(view)
  if (serialized === undefined) {
    const remaining = Object.fromEntries(
      Object.entries(views).filter(([entryKey]) => entryKey !== key)
    )
    return Object.keys(remaining).length > 0 ? JSON.stringify(remaining) : undefined
  }
  views[key] = serialized
  return JSON.stringify(views)
}

export function useTableView(
  key: string,
  fields: ReadonlyArray<TableViewField>,
  resetPage = true
) {
  const search = useRouterState({ select: (state) => state.location.search })
  const navigate = useNavigate()
  const views = readViews(search.tableViews)
  const view = parseTableView(views[key], fields)

  function setView(
    next: TableView | ((current: TableView) => TableView),
    replace = false
  ) {
    void navigate({
      to: '.',
      search: (previous) => {
        const current = parseTableView(readViews(previous.tableViews)[key], fields)
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- React-style updater is an already-typed function-or-value union
        const nextView = typeof next === 'function' ? next(current) : next
        const criteriaChanged =
          current.query !== nextView.query ||
          current.match !== nextView.match ||
          JSON.stringify(current.filters) !== JSON.stringify(nextView.filters) ||
          JSON.stringify(current.sorts) !== JSON.stringify(nextView.sorts)
        return {
          ...previous,
          tableViews: updateTableViews(
            previous.tableViews,
            key,
            criteriaChanged ? { ...nextView, pageIndex: 0 } : nextView
          ),
          page: resetPage ? undefined : previous.page
        }
      },
      resetScroll: false,
      replace
    })
  }

  return { view, setView }
}
