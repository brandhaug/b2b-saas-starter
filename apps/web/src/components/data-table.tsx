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
  functionalUpdate,
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
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Columns3Icon } from 'lucide-react'
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
  readonly manualSorting?: boolean
  readonly sort?: {
    readonly value: SortingState
    readonly onChange: (value: SortingState) => void
  }
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
      className="w-full sm:max-w-xs"
      aria-label={placeholder}
    />
  )
}

export function DataTableColumns() {
  const { columns } = useDataTableContext()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const hidableColumns = columns.filter((column) => column.canHide)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const matchingColumns = hidableColumns.filter((column) =>
    `${column.label} ${column.id}`.toLocaleLowerCase().includes(normalizedQuery)
  )
  const hiddenCount = hidableColumns.filter((column) => !column.visible).length
  if (hidableColumns.length === 0) {
    return null
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setQuery('')
        }
        setOpen(next)
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="xs"
            aria-expanded={open}
            aria-label={m.table_view_columns()}
          />
        }
      >
        <Columns3Icon data-icon="inline-start" /> {m.table_view_columns()}
        {hiddenCount > 0 && (
          <span className="ml-0.5 inline-flex min-w-4 items-center justify-center rounded-sm bg-secondary px-1 text-xs tabular-nums">
            {hiddenCount}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" aria-label={m.table_view_columns()}>
        <div className="border-b border-border p-2">
          <Input
            placeholder={m.table_view_search_columns()}
            aria-label={m.table_view_search_columns()}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-8"
          />
        </div>
        <fieldset
          aria-label={m.table_view_columns()}
          className="max-h-75 overflow-y-auto p-1"
        >
          {matchingColumns.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm">{m.table_view_no_results()}</p>
          ) : (
            matchingColumns.map((column) => (
              <Label
                key={column.id}
                className="focus-within:ring-ring flex h-8 w-full cursor-pointer items-center gap-2 rounded-sm px-2 text-sm hover:bg-muted/50 focus-within:ring-2 max-md:h-11"
              >
                <Checkbox
                  checked={column.visible}
                  onCheckedChange={() => column.setVisible(!column.visible)}
                />
                {column.label}
              </Label>
            ))
          )}
        </fieldset>
      </PopoverContent>
    </Popover>
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
  manualSorting = false,
  sort,
  children
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({})
  const table = useTable({
    features: dataTableFeatures,
    data,
    columns,
    state: { sorting: sort?.value ?? sorting, globalFilter, columnVisibility },
    onSortingChange: (next) => {
      const value = functionalUpdate(next, sort?.value ?? sorting)
      if (sort) {
        sort.onChange(value)
      } else {
        setSorting(value)
      }
      table.setPageIndex(0)
    },
    enableSorting: !manualSorting,
    manualSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
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
        ),
        columns: table.getAllLeafColumns().map((column) => ({
          id: column.id,
          label: headerTitleOf(column.columnDef.header, column.id),
          canHide: column.getCanHide(),
          visible: column.getIsVisible(),
          setVisible: (visible: boolean) => column.toggleVisibility(visible)
        }))
      }}
    >
      <div className="grid gap-3">{children}</div>
    </DataTableContext>
  )
}
