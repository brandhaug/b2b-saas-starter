import { AuditEventLink, AuditEventSheet } from './audit-event-sheet'
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
import { Badge } from '@/components/ui/badge'
import {
  DataTable,
  DataTableContent,
  type DataTableColumnDef
} from '@/components/data-table'
import { WorkspaceShell } from '@/components/workspace-shell'
import {
  auditActorTypeLabel,
  auditEventFilterOptions,
  auditEventLabel
} from '@/lib/audit-labels'
import { auditActorTypeVariant } from '@/lib/badge-variants'
import {
  auditSearchFromFilters,
  compact,
  type ApplyWorkspaceAuditSearch,
  type WorkspaceAuditSearchUpdate
} from '@/lib/audit-search'
import { type WorkspaceAuditPayload } from '@/lib/server/workspace-audit'
import { m } from '@b2b-saas-starter/i18n/messages'
import { formatDateTime } from '@/lib/format-date'
import { type AuditEvent } from '@b2b-saas-starter/capabilities/governance/audit-event-log'

/**
 * The per-workspace audit trail: toolbar over
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
// the render body. The server owns collection order: newest first.
function auditColumns(
  onOpenEvent?: (event: AuditEvent) => void
): Array<DataTableColumnDef<AuditEvent>> {
  return [
    {
      accessorKey: 'createdAt',
      header: m.when_label(),
      enableSorting: false,
      // The shared table timestamp, identical to the admin dashboard's.
      cell: ({ row }) => (
        <span className="font-mono text-muted-foreground whitespace-nowrap tabular-nums">
          {formatDateTime(row.original.createdAt)}
        </span>
      )
    },
    {
      accessorKey: 'eventType',
      header: m.event_label(),
      enableSorting: false,
      cell: ({ row }) =>
        onOpenEvent === undefined ? (
          <AuditEventLink event={row.original} />
        ) : (
          <Button
            id={`audit-event-${row.original.id}`}
            variant="link"
            className="h-auto p-0"
            onClick={() => onOpenEvent(row.original)}
          >
            {auditEventLabel(row.original.eventType)}
          </Button>
        )
    },
    {
      accessorKey: 'targetType',
      header: m.target_label(),
      enableSorting: false,
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
      header: m.actor_label(),
      enableSorting: false,
      // The joined display name alone cannot tell "the platform did this"
      // from "an API token did" — both render as `system` when no user row
      // joins — so the actor type rides beside it as a badge.
      cell: ({ row }) => (
        <span className="flex flex-wrap items-center gap-1.5 break-words">
          {row.original.actor}{' '}
          <Badge variant={auditActorTypeVariant(row.original.actorType)}>
            {auditActorTypeLabel(row.original.actorType)}
          </Badge>
        </span>
      )
    }
  ]
}

export function WorkspaceAuditPage({
  workspaceSlug,
  data,
  applySearch,
  systemRole,
  selectedEventId,
  closeEvent,
  onOpenEvent
}: {
  readonly selectedEventId: string | null
  readonly closeEvent: () => void
  /** Preview mode opens event details in local view state rather than the URL. */
  readonly onOpenEvent?: (event: AuditEvent) => void
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
      layout="wide"
      workspaceSlug={workspaceSlug}
      systemRole={systemRole}
      viewer={data.viewer}
    >
      <PageHeader
        breadcrumb={<WorkspaceCrumb workspaceSlug={workspaceSlug} />}
        title={m.nav_audit_trail()}
        description={m.audit_trail_description()}
      />
      <Panel
        title={m.events()}
        description={m.audit_events_description()}
        actions={
          hasFilters ? (
            <Button variant="ghost" onClick={() => applySearch({})}>
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
              { value: '', label: m.audit_all_actors() },
              ...actorOptions.map((option) => ({
                value: option.id,
                label: option.name
              }))
            ]}
          >
            <SelectTrigger
              id="audit-actor-filter"
              aria-label={m.audit_filter_actor()}
              className={SELECT_CLASSES}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="">{m.audit_all_actors()}</SelectItem>
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
              { value: '', label: m.audit_all_events() },
              ...auditEventFilterOptions().map((option) => ({
                value: option.value,
                label: option.label
              }))
            ]}
          >
            <SelectTrigger
              aria-label={m.audit_filter_event_type()}
              className={SELECT_CLASSES}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="">{m.audit_all_events()}</SelectItem>
                {auditEventFilterOptions().map((option) => (
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
                admin users table, so column treatment and the mono `When` cell
                cannot drift between them. */}
            <DataTable
              columns={auditColumns(onOpenEvent)}
              data={events}
              tableLabel={m.audit_table_label()}
            >
              <DataTableContent />
            </DataTable>
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
      <AuditEventSheet
        eventId={selectedEventId}
        event={data.selectedEvent}
        onClose={closeEvent}
      />
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
            <EmptyTitle>{m.empty_no_events_filters()}</EmptyTitle>
            <EmptyDescription>{m.audit_widen_or_clear()}</EmptyDescription>
          </>
        ) : (
          <>
            <EmptyTitle>{m.empty_no_events()}</EmptyTitle>
            <EmptyDescription>{m.audit_actions_appear()}</EmptyDescription>
          </>
        )}
      </EmptyHeader>
    </Empty>
  )
}
