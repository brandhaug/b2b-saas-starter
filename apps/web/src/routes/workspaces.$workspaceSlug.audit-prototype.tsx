import { createFileRoute, notFound } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { WorkspaceShell } from '@/components/workspace-shell'

// PROTOTYPE (issue #89, wayfinder map #85) — throwaway route answering
// "what does the per-workspace audit page look like?". Three structurally
// different variants switchable via `?variant=` and a floating bottom bar.
// Data is an in-memory mock shaped like AuditEvent + targetId (read contract
// per issue #86). Delete this file once the UX verdict lands on the map.

type AuditRow = {
  readonly id: string
  readonly eventType: string
  readonly targetType: string
  readonly targetId: string | null
  readonly actor: string
  readonly createdAt: string
}

const MOCK_ROWS: readonly AuditRow[] = [
  {
    id: 'aud_1',
    eventType: 'auth.sign_in',
    targetType: 'user_session',
    targetId: null,
    actor: 'Demo Owner',
    createdAt: '2026-08-22T09:14:00Z'
  },
  {
    id: 'aud_2',
    eventType: 'api_token.created',
    targetType: 'api_token',
    targetId: 'apt_9f2c',
    actor: 'Demo Owner',
    createdAt: '2026-08-22T08:50:00Z'
  },
  {
    id: 'aud_3',
    eventType: 'workspace_member.role_changed',
    targetType: 'workspace_member',
    targetId: 'usr_dev',
    actor: 'Demo Owner',
    createdAt: '2026-08-21T16:02:00Z'
  },
  {
    id: 'aud_4',
    eventType: 'webhook_endpoint.created',
    targetType: 'webhook_endpoint',
    targetId: 'whk_b41a',
    actor: 'Dev Member',
    createdAt: '2026-08-21T11:37:00Z'
  },
  {
    id: 'aud_5',
    eventType: 'workspace_invitation.sent',
    targetType: 'workspace_invitation',
    targetId: 'wsi_77e0',
    actor: 'Demo Owner',
    createdAt: '2026-08-21T10:15:00Z'
  },
  {
    id: 'aud_6',
    eventType: 'auth.sign_in_failed',
    targetType: 'user_session',
    targetId: null,
    actor: 'system',
    createdAt: '2026-08-20T23:59:00Z'
  },
  {
    id: 'aud_7',
    eventType: 'api_token.revoked',
    targetType: 'api_token',
    targetId: 'apt_1d03',
    actor: 'Demo Owner',
    createdAt: '2026-08-20T18:44:00Z'
  },
  {
    id: 'aud_8',
    eventType: 'workspace.renamed',
    targetType: 'workspace',
    targetId: 'wrk_starter_lab',
    actor: 'Demo Owner',
    createdAt: '2026-08-19T09:00:00Z'
  },
  {
    id: 'aud_9',
    eventType: 'workspace_member.removed',
    targetType: 'workspace_member',
    targetId: 'usr_old',
    actor: 'Demo Owner',
    createdAt: '2026-08-18T14:21:00Z'
  },
  {
    id: 'aud_10',
    eventType: 'system_admin.user_role_changed',
    targetType: 'user',
    targetId: 'usr_demo',
    actor: 'system',
    createdAt: '2026-08-17T08:05:00Z'
  },
  {
    id: 'aud_11',
    eventType: 'auth.sign_up',
    targetType: 'user',
    targetId: 'usr_new',
    actor: 'New User',
    createdAt: '2026-08-16T13:30:00Z'
  },
  {
    id: 'aud_12',
    eventType: 'webhook_endpoint.disabled',
    targetType: 'webhook_endpoint',
    targetId: 'whk_c99b',
    actor: 'Dev Member',
    createdAt: '2026-08-15T17:12:00Z'
  }
]

const ACTORS = [...new Set(MOCK_ROWS.map((r) => r.actor))]
const EVENT_TYPES = [...new Set(MOCK_ROWS.map((r) => r.eventType))].toSorted()

/** Prettified label fallback — the real page will own a label map keyed off
 * the audit-event-taxonomy constants (issue #87 resolution). */
function eventLabel(eventType: string) {
  const [, verb = eventType] = eventType.split('.')
  return verb.replaceAll('_', ' ')
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC'
  })
}

export const Route = createFileRoute('/workspaces/$workspaceSlug/audit-prototype')({
  validateSearch: (search) => {
    const variant =
      search.variant === 'A' || search.variant === 'B' || search.variant === 'C'
        ? search.variant
        : undefined
    return variant === undefined ? {} : { variant }
  },
  component: AuditPrototypeRoute
})

function AuditPrototypeRoute() {
  // Hidden in production builds — a stray merge cannot ship the prototype.
  if (import.meta.env.PROD) throw notFound()
  const navigate = Route.useNavigate()
  const { variant } = Route.useSearch()
  const resolved = variant === 'B' || variant === 'C' ? variant : 'A'
  return (
    <WorkspaceAuditPrototypePage
      variant={resolved}
      onVariantChange={(key) => {
        void navigate({ search: { variant: key } })
      }}
    />
  )
}

// ── Shared filter state (surfaced on every variant, per skill rule 5) ──────

function useFilters() {
  const [actor, setActor] = useState<string>('')
  const [eventType, setEventType] = useState<string>('')
  const [query, setQuery] = useState<string>('')
  const rows = MOCK_ROWS.filter(
    (r) =>
      (actor === '' || r.actor === actor) &&
      (eventType === '' || r.eventType === eventType) &&
      (query === '' ||
        `${r.eventType} ${r.targetType} ${r.targetId ?? ''} ${r.actor}`
          .toLowerCase()
          .includes(query.toLowerCase()))
  )
  return {
    rows,
    total: MOCK_ROWS.length,
    actor,
    setActor,
    eventType,
    setEventType,
    query,
    setQuery
  }
}

function ActorFilter({
  value,
  onChange
}: {
  value: string
  onChange: (next: string) => void
}) {
  return (
    <select
      aria-label="Filter by actor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-md border border-input bg-transparent px-3 text-base"
    >
      <option value="">All actors</option>
      {ACTORS.map((a) => (
        <option key={a} value={a}>
          {a}
        </option>
      ))}
    </select>
  )
}

function EventTypeFilter({
  value,
  onChange
}: {
  value: string
  onChange: (next: string) => void
}) {
  return (
    <select
      aria-label="Filter by event type"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-md border border-input bg-transparent px-3 text-base"
    >
      <option value="">All events</option>
      {EVENT_TYPES.map((t) => (
        <option key={t} value={t}>
          {eventLabel(t)}
        </option>
      ))}
    </select>
  )
}

function FilterSummary({ shown, total }: { shown: number; total: number }) {
  return (
    <p className="text-muted-foreground text-xs">
      Showing {shown} of {total} events (latest 100 per page · keyset cursor in
      production)
    </p>
  )
}

// ── Variant A: toolbar over a dense TanStack-style table ───────────────────

function VariantToolbarTable() {
  const f = useFilters()
  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit trail</CardTitle>
        <p className="text-muted-foreground text-sm">
          Everything this workspace has done, newest first.
        </p>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search events…"
            value={f.query}
            onChange={(e) => f.setQuery(e.target.value)}
            className="max-w-56"
          />
          <ActorFilter value={f.actor} onChange={f.setActor} />
          <EventTypeFilter value={f.eventType} onChange={f.setEventType} />
        </div>
        <FilterSummary shown={f.rows.length} total={f.total} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Actor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {f.rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatWhen(r.createdAt)}
                </TableCell>
                <TableCell>{eventLabel(r.eventType)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {r.targetType}
                  {r.targetId ? ` · ${r.targetId}` : ''}
                </TableCell>
                <TableCell>{r.actor}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

// ── Variant B: sidebar filters beside the table ────────────────────────────

function VariantSidebarLayout() {
  const f = useFilters()
  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
      <aside className="grid content-start gap-4">
        <div className="grid gap-1.5">
          <span className="text-sm font-medium">Actor</span>
          <ActorFilter value={f.actor} onChange={f.setActor} />
        </div>
        <div className="grid gap-1.5">
          <span className="text-sm font-medium">Event type</span>
          <EventTypeFilter value={f.eventType} onChange={f.setEventType} />
        </div>
        <FilterSummary shown={f.rows.length} total={f.total} />
      </aside>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Event</TableHead>
            <TableHead>Target</TableHead>
            <TableHead>Actor</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {f.rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {formatWhen(r.createdAt)}
              </TableCell>
              <TableCell>{eventLabel(r.eventType)}</TableCell>
              <TableCell className="text-muted-foreground">
                {r.targetType}
                {r.targetId ? ` · ${r.targetId}` : ''}
              </TableCell>
              <TableCell>{r.actor}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// ── Variant C: day-grouped timeline feed with filter chips ─────────────────

function dayOf(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC'
  })
}

/** One pass over the rows, grouped by day in mock-data (newest-first) order. */
function groupByDay(rows: readonly AuditRow[]) {
  const groups = new Map<string, AuditRow[]>()
  for (const row of rows) {
    const day = dayOf(row.createdAt)
    const bucket = groups.get(day)
    if (bucket) {
      bucket.push(row)
    } else {
      groups.set(day, [row])
    }
  }
  return [...groups.entries()]
}

function VariantTimelineFeed() {
  const f = useFilters()
  const days = groupByDay(f.rows)
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={f.actor === '' ? 'default' : 'outline'}
          size="sm"
          onClick={() => f.setActor('')}
        >
          Everyone
        </Button>
        {ACTORS.map((a) => (
          <Button
            key={a}
            variant={f.actor === a ? 'default' : 'outline'}
            size="sm"
            onClick={() => f.setActor(f.actor === a ? '' : a)}
          >
            {a}
          </Button>
        ))}
      </div>
      <FilterSummary shown={f.rows.length} total={f.total} />
      {days.map(([day, dayRows]) => (
        <section key={day} className="grid gap-3">
          <h3 className="text-muted-foreground text-sm font-semibold">{day}</h3>
          <ol className="relative grid gap-4 border-l pl-5">
            {dayRows.map((r) => (
              <li key={r.id} className="relative grid gap-0.5">
                <span className="bg-background absolute top-1.5 -left-[1.57rem] size-2 rounded-full border" />
                <p className="text-sm">
                  <span className="font-medium">{r.actor}</span>{' '}
                  {eventLabel(r.eventType)}{' '}
                  {r.targetId ? (
                    <code className="bg-muted rounded-sm px-1 py-0.5 text-xs">
                      {r.targetId}
                    </code>
                  ) : null}
                </p>
                <p className="text-muted-foreground text-xs">
                  {formatWhen(r.createdAt)} ·{' '}
                  <Badge variant="outline">{r.eventType}</Badge>
                </p>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}

// ── Page shell + floating switcher ─────────────────────────────────────────

const VARIANTS: readonly {
  key: 'A' | 'B' | 'C'
  name: string
}[] = [
  { key: 'A', name: 'Toolbar table' },
  { key: 'B', name: 'Sidebar layout' },
  { key: 'C', name: 'Timeline feed' }
]

export function WorkspaceAuditPrototypePage({
  variant = 'A',
  onVariantChange
}: {
  /** PROTOTYPE — mock-data page for issue #89. Not for production. */
  readonly variant?: 'A' | 'B' | 'C'
  readonly onVariantChange: (key: 'A' | 'B' | 'C') => void
}) {
  const current = variant

  return (
    <WorkspaceShell
      workspaceSlug="starter-lab"
      title="Audit trail"
      description={`Prototype ${current} (${VARIANTS.find((v) => v.key === current)?.name})`}
    >
      {current === 'A' && <VariantToolbarTable />}
      {current === 'B' && <VariantSidebarLayout />}
      {current === 'C' && <VariantTimelineFeed />}
      <PrototypeSwitcher current={current} onChange={onVariantChange} />
    </WorkspaceShell>
  )
}

function PrototypeSwitcher({
  current,
  onChange
}: {
  current: 'A' | 'B' | 'C'
  onChange: (key: 'A' | 'B' | 'C') => void
}) {
  function cycle(delta: number) {
    const index = VARIANTS.findIndex((v) => v.key === current)
    const next = VARIANTS[(index + delta + VARIANTS.length) % VARIANTS.length]
    if (next) onChange(next.key)
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      if (typing) return
      if (e.key === 'ArrowLeft') cycle(-1)
      if (e.key === 'ArrowRight') cycle(1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current])

  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
      <div className="bg-background flex items-center gap-2 rounded-full border px-3 py-2 shadow-lg">
        <Button
          aria-label="Previous variant"
          size="sm"
          variant="ghost"
          onClick={() => cycle(-1)}
        >
          ←
        </Button>
        <span className="min-w-40 text-center text-sm font-medium tabular-nums">
          {current} ({VARIANTS.find((v) => v.key === current)?.name})
        </span>
        <Button
          aria-label="Next variant"
          size="sm"
          variant="ghost"
          onClick={() => cycle(1)}
        >
          →
        </Button>
      </div>
    </div>
  )
}
