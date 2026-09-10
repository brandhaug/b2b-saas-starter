import { m } from '@b2b-saas-starter/i18n/messages'
import { formatNumber } from '@b2b-saas-starter/i18n/format'
import { getLocale } from '@b2b-saas-starter/i18n/runtime'
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
  type ReactTable,
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
import { DataTableContext, useDataTableContext } from './data-table-context'

const STICKY_CLASSES = 'sticky left-0 z-10 bg-card group-hover:bg-muted/50'

function isDate(cell: ReactNode | Date): cell is Date {
  return Object.prototype.toString.call(cell) === '[object Date]'
}

function formatDateCell(value: Date) {
  return <span className="font-mono tabular-nums">{formatDateTime(value)}</span>
}

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
  columnVisibilityFeature
})

type DataTableFeatures = typeof dataTableFeatures
export type DataTableColumnDef<TData extends RowData> = ColumnDef<
  DataTableFeatures,
  TData,
  CellData
>

type SortState = {
  readonly label: (input: { column: string }) => string
  readonly aria: 'ascending' | 'descending' | 'none'
  readonly glyph: string | null
}

const SORT_STATE = {
  asc: { label: m.shell_table_sort_asc, aria: 'ascending', glyph: '▲' },
  desc: { label: m.shell_table_sort_desc, aria: 'descending', glyph: '▼' },
  false: { label: m.shell_table_sort, aria: 'none', glyph: null }
} satisfies Record<'asc' | 'desc' | 'false', SortState>

// oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof
function headerTitleOf(header: unknown, fallback: string): string {
  return typeof header === 'string' ? header : fallback
}
// oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof

type DataTableProps<TData extends RowData> = {
  readonly columns: ReadonlyArray<DataTableColumnDef<TData>>
  readonly data: ReadonlyArray<TData>
  readonly pageSize?: number
  readonly emptyMessage?: string
  readonly tableLabel?: string
  readonly children: ReactNode
}

function DataTableTable<TData extends RowData>({
  columns,
  emptyMessage,
  tableLabel,
  table
}: {
  readonly columns: ReadonlyArray<DataTableColumnDef<TData>>
  readonly emptyMessage: string
  readonly tableLabel: string | undefined
  readonly table: ReactTable<DataTableFeatures, TData>
}) {
  const rowModel = table.getRowModel()
  return (
    <Table aria-label={tableLabel}>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id}>
            {group.headers.map((header) => {
              const canSort = header.column.getCanSort()
              const sortDir = header.column.getIsSorted()
              const columnTitle = headerTitleOf(
                header.column.columnDef.header,
                header.column.id
              )
              const sortState = SORT_STATE[sortDir === false ? 'false' : sortDir]
              const isSticky = header.column.columnDef.meta?.sticky === true
              const label = flexRender(
                header.column.columnDef.header,
                header.getContext()
              )
              return (
                <TableHead
                  key={header.id}
                  aria-sort={canSort ? sortState.aria : undefined}
                  className={cn(isSticky && STICKY_CLASSES)}
                >
                  {canSort && label !== null ? (
                    <Button
                      variant="ghost"
                      onClick={header.column.getToggleSortingHandler()}
                      aria-label={sortState.label({ column: columnTitle })}
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
        {rowModel.rows.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={columns.length}
              className="text-center text-sm text-muted-foreground"
            >
              {emptyMessage}
            </TableCell>
          </TableRow>
        ) : (
          rowModel.rows.map((row) => (
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
  )
}

export function DataTableFilter({ placeholder }: { readonly placeholder: string }) {
  const { globalFilter, setGlobalFilter } = useDataTableContext()
  return (
    <Input
      value={globalFilter}
      onChange={(event) => setGlobalFilter(event.target.value)}
      placeholder={placeholder}
      className="max-w-xs"
      aria-label={placeholder}
    />
  )
}

export function DataTablePagination() {
  const {
    pagination,
    filteredCount,
    pageCount,
    canPreviousPage,
    canNextPage,
    previousPage,
    nextPage
  } = useDataTableContext()
  return (
    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
      <span aria-live="polite">
        {m.shell_table_page({
          count: filteredCount,
          rows: formatNumber(filteredCount, getLocale()),
          page: formatNumber(pagination.pageIndex + 1, getLocale()),
          pages: formatNumber(pageCount, getLocale())
        })}
      </span>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={previousPage}
          disabled={!canPreviousPage}
        >
          {m.shell_table_previous()}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={nextPage}
          disabled={!canNextPage}
        >
          {m.shell_table_next()}
        </Button>
      </div>
    </div>
  )
}

export function DataTableContent() {
  return useDataTableContext().content
}

export function DataTable<TData extends RowData>({
  columns,
  data,
  pageSize,
  emptyMessage = m.shell_table_empty(),
  tableLabel,
  children
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const table = useTable({
    features: dataTableFeatures,
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    manualPagination: pageSize === undefined,
    initialState: {
      pagination: { pageIndex: 0, pageSize: pageSize ?? 10 }
    }
  })
  const filteredCount = table.getFilteredRowModel().rows.length
  return (
    <DataTableContext
      value={{
        globalFilter,
        pagination: table.state.pagination,
        setGlobalFilter: (filterValue: string) => {
          setGlobalFilter(filterValue)
          table.setPageIndex(0)
        },
        previousPage: () => table.previousPage(),
        nextPage: () => table.nextPage(),
        filteredCount,
        pageCount: table.getPageCount(),
        canPreviousPage: table.getCanPreviousPage(),
        canNextPage: table.getCanNextPage(),
        content: (
          <DataTableTable
            columns={columns}
            emptyMessage={emptyMessage}
            tableLabel={tableLabel}
            table={table}
          />
        )
      }}
    >
      <div className="grid gap-3">{children}</div>
    </DataTableContext>
  )
}
