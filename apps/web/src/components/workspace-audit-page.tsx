import { FilterXIcon, HistoryIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { PageHeader } from '@/components/page/page-header'
import { Panel } from '@/components/page/panel'
import { WorkspaceCrumb } from '@/components/page/workspace-crumb'
import { DataTable, type DataTableColumnDef } from '@/components/data-table'
import { WorkspaceShell } from '@/components/workspace-shell'
import { AUDIT_EVENT_FILTER_OPTIONS, auditEventLabel } from '@/lib/audit-labels'
import {
  auditSearchFromFilters,
  compact,
  type ApplyWorkspaceAuditSearch,
  type WorkspaceAuditSearchUpdate
} from '@/lib/audit-search'
import { type WorkspaceAuditPayload } from '@/lib/server/workspace-audit'
import { formatDateTime } from '@/lib/format-date'
import { type AuditEvent } from '@b2b-saas-starter/capabilities/governance/audit-event-log'

/**
 * The per-workspace audit trail (issue #118, prototype verdict A): toolbar over
 * a dense table. All state — filters and keyset cursor — lives in the URL as
 * search params, so every change re-runs the loader server-side against
 * `AuditEventLog.list`; there is no client-side row model to keep in sync.
 *
 * Writing that state to the URL is the one thing this page cannot do alone:
 * `applySearch` comes from the route's navigator, which also makes the page
 * renderable from a test with plain props — no router, no mocked hooks. The
 * URL vocabulary and its translation live in `lib/audit-search.ts`.
 */

const SELECT_CLASSES = 'max-w-52'

// Column definitions are static — module scope keeps the cell renderers out of
// the render body (they would remount every render). Sorting reorders the
// loaded page locally; the server's own order stays newest-first.
const auditColumns: Array<DataTableColumnDef<AuditEvent>> = [
  {
    accessorKey: 'createdAt',
    header: 'When',
    enableSorting: true,
    // The shared table timestamp, identical to the admin dashboard's.
    cell: ({ row }) => (
      <span className="font-mono text-muted-foreground whitespace-nowrap tabular-nums">
        {formatDateTime(row.original.createdAt)}
      </span>
    )
  },
  {
    accessorKey: 'eventType',
    header: 'Event',
    enableSorting: true,
    cell: ({ row }) => auditEventLabel(row.original.eventType)
  },
  {
    accessorKey: 'targetType',
    header: 'Target',
    enableSorting: true,
    // Target ids are the long values — this wraps instead of forcing the
    // table out to 700px on a phone, where the other columns clip.
    cell: ({ row }) => (
      <span className="text-muted-foreground break-words">
        {row.original.targetType}
        {row.original.targetId ? ` · ${row.original.targetId}` : ''}
      </span>
    )
  },
  {
    accessorKey: 'actor',
    header: 'Actor',
    enableSorting: true,
    cell: ({ row }) => <span className="break-words">{row.original.actor}</span>
  }
]

export function WorkspaceAuditPage({
  workspaceSlug,
  data,
  applySearch,
  systemRole
}: {
  readonly workspaceSlug: string
  readonly data: WorkspaceAuditPayload
  readonly applySearch: ApplyWorkspaceAuditSearch
  /** The signed-in user's Better Auth system role, for the shell's admin link. */
  readonly systemRole?: string | null
}) {
  const { events, nextCursor, filters, members } = data
  const searchFilters = auditSearchFromFilters(filters)

  // Filters changed: drop the cursor — a new filter addresses page one.
  function withFilter(patch: Omit<WorkspaceAuditSearchUpdate, 'cursor'>) {
    applySearch(compact({ ...searchFilters, ...patch }))
  }
  function nextPage() {
    if (nextCursor === null) {
      return
    }
    applySearch(compact({ ...searchFilters, cursor: nextCursor }))
  }

  const hasFilters =
    filters.actorUserId !== undefined ||
    filters.eventType !== undefined ||
    filters.since !== undefined ||
    filters.until !== undefined
  // The actor filter keys on user ids (the capability's filter contract), so
  // it offers the workspace's members by id.
  const actorOptions = members

  return (
    <WorkspaceShell
      workspaceSlug={workspaceSlug}
      systemRole={systemRole}
      viewer={data.viewer}
    >
      <PageHeader
        breadcrumb={<WorkspaceCrumb workspaceSlug={workspaceSlug} />}
        title="Audit trail"
        description="Everything this workspace has done, newest first."
      />
      <Panel
        title="Events"
        description="Newest first, up to 100 events per server page."
        actions={
          hasFilters ? (
            <Button variant="ghost" onClick={() => withFilter({})}>
              <FilterXIcon aria-hidden className="size-4" />
              Clear
            </Button>
          ) : undefined
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={filters.actorUserId ?? ''}
            onValueChange={(value) => {
              if (value !== null) {
                withFilter({ actor: value })
              }
            }}
            items={[
              { value: '', label: 'All actors' },
              ...actorOptions.map((option) => ({
                value: option.id,
                label: option.name
              }))
            ]}
          >
            <SelectTrigger aria-label="Filter by actor" className={SELECT_CLASSES}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="">All actors</SelectItem>
                {actorOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select
            value={filters.eventType ?? ''}
            onValueChange={(value) => {
              if (value !== null) {
                withFilter({ eventType: value })
              }
            }}
            items={[
              { value: '', label: 'All events' },
              ...AUDIT_EVENT_FILTER_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label
              }))
            ]}
          >
            <SelectTrigger aria-label="Filter by event type" className={SELECT_CLASSES}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="">All events</SelectItem>
                {AUDIT_EVENT_FILTER_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {/* `Label` + `htmlFor`: the date inputs get a visible label — and
              the programmatic name that comes with it — instead of an
              aria-label only. */}
          <div className="flex items-center gap-2">
            <Label
              htmlFor="audit-since"
              className="text-xs font-normal text-muted-foreground"
            >
              Since
            </Label>
            <Input
              id="audit-since"
              type="date"
              value={filters.since ?? ''}
              onChange={(e) => withFilter({ since: e.target.value })}
              className="w-36"
            />
          </div>
          <div className="flex items-center gap-2">
            <Label
              htmlFor="audit-until"
              className="text-xs font-normal text-muted-foreground"
            >
              Until
            </Label>
            <Input
              id="audit-until"
              type="date"
              value={filters.until ?? ''}
              onChange={(e) => withFilter({ until: e.target.value })}
              className="w-36"
            />
          </div>
        </div>
        {events.length === 0 ? (
          <EmptyTrail hasFilters={hasFilters} />
        ) : (
          <>
            {/* One row model for both tables: the same component renders the
                admin users table, so column treatment, the mono `When` cell,
                and the count footer cannot drift between them. `pager={false}`
                drops `DataTable`'s own Previous/Next footer — this table pages
                through the keyset button below, so a second, always-disabled
                "Page 1 of 1" model would read as broken. */}
            <DataTable
              columns={auditColumns}
              data={events}
              pageSize={100}
              tableLabel="Audit events, newest first"
              pager={false}
            />
            <div className="flex items-center justify-end">
              {/* Keyset pagination has exactly one direction: older. The
                button carries the opaque cursor back through the URL. */}
              <Button
                variant="outline"
                disabled={nextCursor === null}
                onClick={() => nextPage()}
              >
                Older events
              </Button>
            </div>
          </>
        )}
      </Panel>
    </WorkspaceShell>
  )
}

function EmptyTrail({ hasFilters }: { readonly hasFilters: boolean }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HistoryIcon aria-hidden />
        </EmptyMedia>
        {hasFilters ? (
          <>
            <EmptyTitle>No events match these filters</EmptyTitle>
            <EmptyDescription>
              Widen the date range or clear a filter to see more of the trail.
            </EmptyDescription>
          </>
        ) : (
          <>
            <EmptyTitle>Nothing audited yet</EmptyTitle>
            <EmptyDescription>
              Actions in this workspace (tokens, webhooks, membership) appear here as
              they happen.
            </EmptyDescription>
          </>
        )}
      </EmptyHeader>
    </Empty>
  )
}
