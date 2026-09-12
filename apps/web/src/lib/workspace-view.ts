import { pickOptionalStrings } from '@/lib/utils'
import { useNavigate, useRouterState } from '@tanstack/react-router'

/** Shareable presentation state; never an authorization or mutation input. */
export type WorkspaceView = {
  readonly tab?: string | undefined
  readonly action?: string | undefined
  readonly query?: string | undefined
  readonly filter?: string | undefined
  readonly sort?: string | undefined
  readonly page?: string | undefined
  readonly record?: string | undefined
}

export function workspaceViewSearch(search: {
  readonly page?: unknown
}): WorkspaceView {
  const strings = pickOptionalStrings(search, [
    'tab',
    'action',
    'query',
    'filter',
    'sort',
    'page',
    'record'
  ])
  return {
    ...strings,
    page:
      Number.isSafeInteger(search.page) && Number(search.page) > 0
        ? String(Number(search.page))
        : strings.page
  }
}

export function useWorkspaceView() {
  const search = useRouterState({ select: (state) => state.location.search })
  const navigate = useNavigate()
  const view = workspaceViewSearch(search)
  function update(change: WorkspaceView, replace = false) {
    void navigate({
      to: '.',
      search: (previous) => ({ ...previous, ...change }),
      replace,
      resetScroll: false
    })
  }
  return { view, update }
}
