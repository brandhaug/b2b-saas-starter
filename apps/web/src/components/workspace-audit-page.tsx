import { AuditEventLink, AuditEventSheet } from './audit-event-sheet'
import { HistoryIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty'
import { PageHeader } from '@/components/page/page-header'
import { WorkspaceCrumb } from '@/components/page/workspace-crumb'
import { Badge } from '@/components/ui/badge'
import {
  DataTable,
  DataTableColumns,
  DataTableContent,
  type DataTableColumnDef
} from '@/components/data-table'
import { WorkspaceShell } from '@/components/workspace-shell'
import { auditActorTypeLabel, auditEventLabel } from '@/lib/audit-labels'
import { auditActorTypeVariant } from '@/lib/badge-variants'
import {
  auditSearchFromFilters,
  compact,
  auditViewFields,
  type ApplyWorkspaceAuditSearch
} from '@/lib/audit-search'
import { type WorkspaceAuditPayload } from '@/lib/server/workspace-audit'
import { m } from '@b2b-saas-starter/i18n/messages'
import { formatDateTime } from '@/lib/format-date'
import { type AuditEvent } from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import { TableViewControls } from './table-view-controls'
import {
  defaultTableView,
  serializeTableView,
  type TableView,
  type TableViewField
} from '@/lib/table-view'

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

// The server owns collection order; column labels follow the active locale.
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
  const view: TableView = data.view ?? defaultTableView
  const searchFilters = {
    ...auditSearchFromFilters(filters),
    ...(serializeTableView(view) !== undefined && { view: serializeTableView(view) })
  }
  const viewFields: ReadonlyArray<TableViewField> = auditViewFields().map((field) =>
    field.id === 'actorUserId'
      ? {
          id: field.id,
          label: field.label,
          kind: 'select',
          options: members.map((member) => ({ value: member.id, label: member.name }))
        }
      : field
  )

  const legacyFilters: Array<{
    key: 'actor' | 'eventType' | 'since' | 'until'
    label: string
  }> = []
  if (filters.actorUserId !== undefined) {
    const actor =
      members.find((member) => member.id === filters.actorUserId)?.name ??
      filters.actorUserId
    legacyFilters.push({ key: 'actor', label: `${m.actor_label()} ${actor}` })
  }
  if (filters.eventType !== undefined) {
    legacyFilters.push({
      key: 'eventType',
      label: `${m.event_label()} ${auditEventLabel(filters.eventType)}`
    })
  }
  if (filters.since !== undefined) {
    legacyFilters.push({ key: 'since', label: `${m.when_label()} ≥ ${filters.since}` })
  }
  if (filters.until !== undefined) {
    legacyFilters.push({ key: 'until', label: `${m.when_label()} ≤ ${filters.until}` })
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
      <section aria-label={m.events()} className="grid gap-4">
        {/* One row model for both tables: the same component renders the admin
            users table, so column treatment and the mono `When` cell cannot drift. */}
        <DataTable
          columns={auditColumns(onOpenEvent)}
          data={events}
          manualSorting
          tableLabel={m.audit_table_label()}
        >
          <div
            id="audit-view-controls"
            className="flex flex-wrap items-center justify-between gap-2"
          >
            <TableViewControls
              fields={viewFields}
              view={view}
              onChange={(next) => {
                if (next.filters.length === 0 && next.sorts.length === 0) {
                  applySearch({})
                  return
                }
                applySearch(
                  compact({
                    ...auditSearchFromFilters(filters),
                    view: serializeTableView(next)
                  })
                )
              }}
            />
            <DataTableColumns />
          </div>
          {hasFilters && (
            <div className="flex flex-wrap items-center gap-2">
              {legacyFilters.map((filter) => (
                <Button
                  key={filter.key}
                  variant="outline"
                  size="xs"
                  aria-label={`${m.action_remove()} ${filter.label}`}
                  onClick={() =>
                    applySearch(compact({ ...searchFilters, [filter.key]: undefined }))
                  }
                >
                  {filter.label}
                  <XIcon aria-hidden className="size-3" />
                </Button>
              ))}
              {view.filters.length === 0 && view.sorts.length === 0 && (
                <Button variant="ghost" onClick={() => applySearch({})}>
                  {m.table_view_clear_all()}
                </Button>
              )}
            </div>
          )}
          {events.length === 0 ? (
            <EmptyTrail
              hasFilters={hasFilters || view.filters.length > 0}
              onClear={() => applySearch({})}
            />
          ) : (
            <DataTableContent />
          )}
        </DataTable>
        {events.length > 0 && (
          <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
            <p className="text-sm text-muted-foreground">
              {m.audit_events_description()}
            </p>
            {/* The cursor resumes after the current page in the selected order. */}
            <Button
              variant="outline"
              disabled={nextCursor === null}
              onClick={() => nextPage()}
            >
              {m.shell_table_next()}
            </Button>
          </div>
        )}
      </section>
      <AuditEventSheet
        eventId={selectedEventId}
        event={data.selectedEvent}
        onClose={closeEvent}
      />
    </WorkspaceShell>
  )
}

function EmptyTrail({
  hasFilters,
  onClear
}: {
  readonly hasFilters: boolean
  readonly onClear: () => void
}) {
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
            <Button variant="outline" onClick={onClear}>
              {m.table_view_clear_all()}
            </Button>
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
