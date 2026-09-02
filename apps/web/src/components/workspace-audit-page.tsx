import { FilterXIcon, HistoryIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { WorkspaceShell } from '@/components/workspace-shell'
import { AUDIT_EVENT_FILTER_OPTIONS, auditEventLabel } from '@/lib/audit-labels'
import {
  auditSearchFromFilters,
  compact,
  type ApplyWorkspaceAuditSearch,
  type WorkspaceAuditSearchUpdate
} from '@/lib/audit-search'
import { type WorkspaceAuditPayload } from '@/lib/server/workspace-audit'
import { formatUtc } from '@/lib/format-date'

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

function formatWhen(iso: string): string {
  return formatUtc(iso, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

const SELECT_CLASSES = 'max-w-52'

export function WorkspaceAuditPage({
  workspaceSlug,
  data,
  applySearch
}: {
  readonly workspaceSlug: string
  readonly data: WorkspaceAuditPayload
  readonly applySearch: ApplyWorkspaceAuditSearch
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
      viewer={data.viewer}
      title="Audit trail"
      description="Everything this workspace has done, newest first."
    >
      <Card>
        <CardHeader>
          <CardTitle as="h2">Audit trail</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
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
              <SelectTrigger
                aria-label="Filter by event type"
                className={SELECT_CLASSES}
              >
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
            <Input
              aria-label="Since date"
              type="date"
              value={filters.since ?? ''}
              onChange={(e) => withFilter({ since: e.target.value })}
              className="w-40"
            />
            <Input
              aria-label="Until date"
              type="date"
              value={filters.until ?? ''}
              onChange={(e) => withFilter({ until: e.target.value })}
              className="w-40"
            />
            {hasFilters ? (
              <Button variant="ghost" size="sm" onClick={() => withFilter({})}>
                <FilterXIcon aria-hidden className="size-4" />
                Clear
              </Button>
            ) : null}
          </div>
          <p className="text-muted-foreground text-xs" aria-live="polite">
            Showing {events.length} event{events.length === 1 ? '' : 's'}
            {hasFilters ? ' matching these filters' : ''} · newest first · up to 100 per
            page
          </p>
          {events.length === 0 ? (
            <EmptyTrail hasFilters={hasFilters} />
          ) : (
            <>
              <Table aria-label="Audit events, newest first">
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">When</TableHead>
                    <TableHead scope="col">Event</TableHead>
                    <TableHead scope="col">Target</TableHead>
                    <TableHead scope="col">Actor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell className="text-muted-foreground whitespace-nowrap tabular-nums">
                        {formatWhen(event.createdAt)}
                      </TableCell>
                      <TableCell>{auditEventLabel(event.eventType)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {event.targetType}
                        {event.targetId ? ` · ${event.targetId}` : ''}
                      </TableCell>
                      <TableCell>{event.actor}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex items-center justify-end">
                {/* Keyset pagination has exactly one direction: older. The
                  button carries the opaque cursor back through the URL. */}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={nextCursor === null}
                  onClick={() => nextPage()}
                >
                  Older events
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
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
