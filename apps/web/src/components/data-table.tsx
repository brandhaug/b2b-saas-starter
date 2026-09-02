import { useState, type ReactNode } from 'react'
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
import { formatDateTime } from '@/lib/format-date'

const STICKY_CLASSES = 'sticky left-0 z-10 bg-card group-hover:bg-muted/50'

/** Deterministic UTC rendering so SSR and the browser agree; table
 * convention sets identifiers and timestamps in mono tabular figures. */
function isDate(cell: ReactNode | Date): cell is Date {
  return Object.prototype.toString.call(cell) === '[object Date]'
}

function formatDateCell(value: Date) {
  return <span className="font-mono tabular-nums">{formatDateTime(value)} UTC</span>
}

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

const SORT_STATE = {
  asc: { label: ', currently ascending', aria: 'ascending', glyph: '▲' },
  desc: { label: ', currently descending', aria: 'descending', glyph: '▼' },
  false: { label: '', aria: 'none', glyph: null }
} satisfies Record<'asc' | 'desc' | 'false', SortState>

/** A column's header titles its sort button only when it is a plain string. */
// oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof -- column definitions arrive untyped from the table's public API; this probe is the parse step
function headerTitleOf(header: unknown, fallback: string): string {
  return typeof header === 'string' ? header : fallback
}
// oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof

type DataTableProps<TData extends RowData> = {
  readonly columns: ReadonlyArray<DataTableColumnDef<TData>>
  readonly data: ReadonlyArray<TData>
  readonly filterPlaceholder?: string
  readonly filterColumnId?: string
  readonly pageSize?: number
  readonly emptyMessage?: string
  /** Accessible name for the underlying `<table>` element. */
  readonly tableLabel?: string
}

export function DataTable<TData extends RowData>({
  columns,
  data,
  filterPlaceholder,
  filterColumnId,
  pageSize = 10,
  emptyMessage = 'No results.',
  tableLabel
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')

  // `useTable` keys its internal state on input identities. Consumers pass
  // module-scope constants or stable loader arrays, so the props are handed
  // straight through — copying (`[...data]`) would re-allocate (and
  // re-notify) every render.
  const table = useTable({
    features: dataTableFeatures,
    data,
    columns,
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
      <Table aria-label={tableLabel}>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => {
                const canSort = header.column.getCanSort()
                const sortDir = header.column.getIsSorted()
                // A column's header is either a plain title or a render
                // function; only the first can label the sort button, so fall
                // back to the column id for the latter.
                const columnTitle = headerTitleOf(
                  header.column.columnDef.header,
                  header.column.id
                )
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
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={header.column.getToggleSortingHandler()}
                        aria-label={`Sort by ${columnTitle}${sortState.label}`}
                      >
                        {label}
                        {sortState.glyph}
                      </Button>
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
              <TableRow key={row.id} className="group">
                {row.getVisibleCells().map((cell) => {
                  const isSticky = cell.column.columnDef.meta?.sticky === true
                  const rendered = flexRender(
                    cell.column.columnDef.cell,
                    cell.getContext()
                  )
                  return (
                    <TableCell key={cell.id} className={cn(isSticky && STICKY_CLASSES)}>
                      {isDate(rendered) ? formatDateCell(rendered) : rendered}
                    </TableCell>
                  )
                })}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        {/* Live: filter/pagination changes announce the new count, as the
            audit trail's count already does. */}
        <span aria-live="polite">
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
    </div>
  )
}
