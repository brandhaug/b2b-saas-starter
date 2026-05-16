import { useState } from 'react'
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type ColumnDef,
  type RowData,
  type SortingState,
  useReactTable
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

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    readonly sticky?: boolean
  }
}

const STICKY_CLASSES = 'sticky left-0 z-10 bg-card'

const SORT_STATE = {
  asc: { label: ', currently ascending', aria: 'ascending' as const, glyph: '▲' },
  desc: { label: ', currently descending', aria: 'descending' as const, glyph: '▼' },
  false: { label: '', aria: 'none' as const, glyph: null as string | null }
} as const

type DataTableProps<TData, TValue> = {
  readonly columns: readonly ColumnDef<TData, TValue>[]
  readonly data: readonly TData[]
  readonly filterPlaceholder?: string
  readonly filterColumnId?: string
  readonly pageSize?: number
  readonly emptyMessage?: string
}

export function DataTable<TData, TValue>({
  columns,
  data,
  filterPlaceholder,
  filterColumnId,
  pageSize = 10,
  emptyMessage = 'No results.'
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')

  const table = useReactTable({
    data: [...data],
    columns: [...columns],
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } }
  })

  const filteredCount = table.getFilteredRowModel().rows.length

  return (
    <div className="grid gap-3">
      {filterColumnId !== undefined ? (
        <Input
          value={globalFilter}
          onChange={(event) => setGlobalFilter(event.target.value)}
          placeholder={filterPlaceholder ?? 'Filter…'}
          className="max-w-xs"
          aria-label={filterPlaceholder ?? 'Filter rows'}
        />
      ) : null}
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
                return (
                  <TableHead
                    key={header.id}
                    aria-sort={canSort ? sortState.aria : undefined}
                    className={cn(isSticky && STICKY_CLASSES)}
                  >
                    {canSort && !header.isPlaceholder ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        aria-label={`Sort by ${columnTitle}${sortState.label}`}
                        className="flex items-center gap-1 text-left text-sm font-medium hover:underline"
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                        {sortState.glyph}
                      </button>
                    ) : header.isPlaceholder ? null : (
                      flexRender(header.column.columnDef.header, header.getContext())
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
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
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
