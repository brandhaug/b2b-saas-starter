import { type ReactNode } from 'react'
import { type RowData } from '@tanstack/react-table'
import { applyTableView, type TableViewField } from '@/lib/table-view'
import { useTableView } from '@/lib/use-table-view'
import { TableViewControls } from './table-view-controls'
import {
  DataTable,
  DataTableColumns,
  DataTableFilter,
  type DataTableColumnDef
} from './data-table'

export type DataTableField<TData> = TableViewField & {
  readonly value: (row: TData) => string | number | boolean | Date | null | undefined
}

/** Shares URL-backed controls with lists while TanStack owns table rendering and pagination. */
export function FilterableDataTable<TData extends RowData>({
  viewKey,
  fields,
  columns,
  data,
  pageSize,
  tableLabel,
  emptyMessage,
  searchPlaceholder,
  children
}: {
  readonly viewKey: string
  readonly fields: ReadonlyArray<DataTableField<TData>>
  readonly columns: ReadonlyArray<DataTableColumnDef<TData>>
  readonly data: ReadonlyArray<TData>
  readonly pageSize?: number
  readonly tableLabel: string
  readonly emptyMessage: string
  readonly searchPlaceholder?: string
  readonly children: ReactNode
}) {
  const { view, setView } = useTableView(viewKey, fields, false)
  const filtered = applyTableView(data, { ...view, sorts: [] }, (row, field) =>
    fields.find((candidate) => candidate.id === field)?.value(row)
  )

  return (
    <DataTable
      columns={columns}
      data={filtered}
      {...(pageSize === undefined ? {} : { pageSize })}
      tableLabel={tableLabel}
      emptyMessage={emptyMessage}
      sort={{
        value: view.sorts.map((item) => ({
          id: item.field,
          desc: item.direction === 'desc'
        })),
        onChange: (sorting) =>
          setView({
            ...view,
            sorts: sorting.map((item) => ({
              field: item.id,
              direction: item.desc ? 'desc' : 'asc'
            }))
          })
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {searchPlaceholder && <DataTableFilter placeholder={searchPlaceholder} />}
          <TableViewControls fields={fields} view={view} onChange={setView} />
        </div>
        <DataTableColumns />
      </div>
      {children}
    </DataTable>
  )
}
