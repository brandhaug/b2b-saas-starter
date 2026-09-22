import { useNavigate, useRouterState } from '@tanstack/react-router'

import {
  parseTableView,
  serializeTableView,
  type TableView,
  type TableViewField
} from '@/lib/table-view'

const MAX_VIEWS = 24

type SerializedViews = Record<string, string>
/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, effect/noTryCatch -- tableViews is an intentionally plain URL search payload. */

function readViews(value: unknown): SerializedViews {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key, serialized]) => key.length <= 128 && typeof serialized === 'string'
        )
        .slice(0, MAX_VIEWS)
    )
  }
  if (typeof value !== 'string' || value.length > 32_768) {
    return {}
  }
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {}
    }
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(
          ([key, serialized]) => key.length <= 128 && typeof serialized === 'string'
        )
        .slice(0, MAX_VIEWS)
    )
  } catch {
    return {}
  }
}

/** Update one saved view while preserving the other lists' URL state. */
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
    const nextView = typeof next === 'function' ? next(view) : next
    void navigate({
      to: '.',
      search: (previous) => ({
        ...previous,
        tableViews: updateTableViews(previous.tableViews, key, nextView),
        page: resetPage ? undefined : previous.page
      }),
      resetScroll: false,
      replace
    })
  }

  return { view, setView }
}
/* oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, effect/noTryCatch */
