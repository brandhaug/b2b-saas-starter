import { useState } from 'react'
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  flexRender,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  useTable,
  type CellData,
  type ColumnDef,
  type RowData,
  type SortingState
} from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

const STICKY_CLASSES = 'sticky left-0 z-10 bg-card'

// v9 registers features explicitly (prerequisites before their slots). The
// registered `sortFns` are the ones `sortFn: 'auto'` can resolve for a column.
const dataTableFeatures = tableFeatures({
  columnFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  globalFilteringFeature,
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    datetime: sortFn_datetime,
    text: sortFn_text
  },
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
  // `row.getVisibleCells()` lives on this feature.
  columnVisibilityFeature
})

/** The feature set every `DataTable` column definition is typed against. */
export type DataTableFeatures = typeof dataTableFeatures

/** `ColumnDef` bound to `DataTable`'s feature set — use it in consumers. */
export type DataTableColumnDef<TData extends RowData> = ColumnDef<
  DataTableFeatures,
  TData,
  CellData
>

type SortState = {
  /** Appended to the sort button's accessible name. */
  readonly label: string
  /** The `aria-sort` value for the header cell. */
  readonly aria: 'ascending' | 'descending' | 'none'
  readonly glyph: string | null
}

const SORT_STATE: Record<'asc' | 'desc' | 'false', SortState> = {
  asc: { label: ', currently ascending', aria: 'ascending', glyph: '▲' },
  desc: { label: ', currently descending', aria: 'descending', glyph: '▼' },
  false: { label: '', aria: 'none', glyph: null }
}

type DataTableProps<TData extends RowData> = {
  readonly columns: readonly DataTableColumnDef<TData>[]
  readonly data: readonly TData[]
  readonly filterPlaceholder?: string
  readonly filterColumnId?: string
  readonly pageSize?: number
  readonly emptyMessage?: string
}

export function DataTable<TData extends RowData>({
  columns,
  data,
  filterPlaceholder,
  filterColumnId,
  pageSize = 10,
  emptyMessage = 'No results.'
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')

  const table = useTable({
    features: dataTableFeatures,
    data: [...data],
    columns: [...columns],
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    initialState: { pagination: { pageIndex: 0, pageSize } }
  })

  const filteredCount = table.getFilteredRowModel().rows.length

  return (
    <div className="grid gap-3">
      {filterColumnId === undefined ? null : (
        <Input
          value={globalFilter}
          onChange={(event) => setGlobalFilter(event.target.value)}
          placeholder={filterPlaceholder ?? 'Filter…'}
          className="max-w-xs"
          aria-label={filterPlaceholder ?? 'Filter rows'}
        />
      )}
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => {
                const canSort = header.column.getCanSort()
                const sortDir = header.column.getIsSorted()
                const headerDef = header.column.columnDef.header
                const columnTitle =
                  typeof headerDef === 'string' ? headerDef : header.column.id
                const sortState = SORT_STATE[sortDir === false ? 'false' : sortDir]
                const isSticky = header.column.columnDef.meta?.sticky === true
                // Placeholder headers (spanned group cells) render nothing, so
                // they never get the sort button either.
                const label = header.isPlaceholder
                  ? null
                  : flexRender(header.column.columnDef.header, header.getContext())
                return (
                  <TableHead
                    key={header.id}
                    aria-sort={canSort ? sortState.aria : undefined}
                    className={cn(isSticky && STICKY_CLASSES)}
                  >
                    {canSort && label !== null ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        aria-label={`Sort by ${columnTitle}${sortState.label}`}
                        className="flex items-center gap-1 text-left text-sm font-medium hover:underline"
                      >
                        {label}
                        {sortState.glyph}
                      </button>
                    ) : (
                      label
                    )}
                  </TableHead>
                )
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="text-center text-sm text-muted-foreground"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => {
                  const isSticky = cell.column.columnDef.meta?.sticky === true
                  return (
                    <TableCell key={cell.id} className={cn(isSticky && STICKY_CLASSES)}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  )
                })}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {filteredCount > pageSize ? (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            Page {table.state.pagination.pageIndex + 1} of {table.getPageCount()}
            {' · '}
            {filteredCount} rows
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
