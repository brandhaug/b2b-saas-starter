import { type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TableViewControls } from '@/components/table-view-controls'
import { type TableView, type TableViewField } from '@/lib/table-view'
import { useWorkspaceView } from '@/lib/workspace-view'
import { m } from '@b2b-saas-starter/i18n/messages'

export function DeveloperListToolbar({
  query,
  searchLabel,
  fields,
  view,
  onViewChange
}: {
  readonly query: string
  readonly searchLabel: string
  readonly fields: ReadonlyArray<TableViewField>
  readonly view: TableView
  readonly onViewChange: (view: TableView) => void
}) {
  const { update } = useWorkspaceView()
  return (
    <div
      className="flex flex-col gap-2 md:flex-row md:items-center"
      aria-label={searchLabel}
    >
      <Input
        className="bg-card md:max-w-sm"
        aria-label={searchLabel}
        placeholder={searchLabel}
        value={query}
        onChange={(event) => {
          update({ query: event.target.value || undefined, page: undefined }, true)
        }}
      />
      <div className="hidden md:block">
        <TableViewControls fields={fields} view={view} onChange={onViewChange} />
      </div>
      <details className="w-full md:hidden">
        <summary className="flex min-h-11 cursor-pointer items-center justify-between rounded-md border border-border px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          <span>{m.developer_list_filters()}</span>
          {view.filters.length + view.sorts.length > 0 ? (
            <span className="text-muted-foreground">
              {m.developer_list_filter_count({
                count: view.filters.length + view.sorts.length
              })}
            </span>
          ) : null}
        </summary>
        <div className="pt-2">
          <TableViewControls fields={fields} view={view} onChange={onViewChange} />
        </div>
      </details>
    </div>
  )
}

export function DeveloperListPagination({
  page,
  pageCount
}: {
  readonly page: number
  readonly pageCount: number
}): ReactNode {
  const { update } = useWorkspaceView()
  if (pageCount <= 1) {
    return null
  }

  return (
    <nav
      className="flex items-center justify-between pt-2"
      aria-label={m.developer_list_page({ page, pages: pageCount })}
    >
      <span className="text-xs text-muted-foreground">
        {m.developer_list_page({ page, pages: pageCount })}
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="xs"
          disabled={page === 1}
          onClick={() => update({ page: page === 2 ? undefined : String(page - 1) })}
        >
          {m.developer_list_previous()}
        </Button>
        <Button
          variant="outline"
          size="xs"
          disabled={page === pageCount}
          onClick={() => update({ page: String(page + 1) })}
        >
          {m.developer_list_next()}
        </Button>
      </div>
    </nav>
  )
}
