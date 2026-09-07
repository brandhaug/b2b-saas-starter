import { createContext, use, type ReactNode } from 'react'
import { type PaginationState, type SortingState } from '@tanstack/react-table'

export type DataTableContextValue = {
  readonly state: {
    readonly sorting: SortingState
    readonly globalFilter: string
    readonly pagination: PaginationState
  }
  readonly actions: {
    readonly setGlobalFilter: (value: string) => void
    readonly previousPage: () => void
    readonly nextPage: () => void
  }
  readonly meta: {
    readonly filteredCount: number
    readonly pageCount: number
    readonly canPreviousPage: boolean
    readonly canNextPage: boolean
    readonly content: ReactNode
  }
}

export const DataTableContext = createContext<DataTableContextValue | null>(null)

export function useDataTableContext() {
  const value = use(DataTableContext)
  if (value === null) {
    // oxlint-disable-next-line effect/noThrowStatement, effect/noNewError -- provider misuse is a programmer invariant handled by the render error boundary
    throw new Error('DataTable controls must be rendered inside a DataTable')
  }
  return value
}
