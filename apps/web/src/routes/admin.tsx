import { useMemo } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { Effect } from 'effect'
import { DataTable } from '@/components/data-table'
import { WorkspaceShell } from '@/components/workspace-shell'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { runWorkspaceCapabilities } from '@/lib/capabilities'
import { requireSession } from '@/lib/server/auth'
import {
  AuditEventLog,
  NotificationFeed,
  WorkspaceMembership,
  type AuditEvent,
  type Member
} from '@b2b-saas-starter/capabilities'

const SHOWCASE_SLUG = 'starter-lab'

export const Route = createFileRoute('/admin')({
  beforeLoad: ({ location }) => requireSession(location.href),
  loader: () =>
    runWorkspaceCapabilities(
      SHOWCASE_SLUG,
      Effect.gen(function* () {
        const membership = yield* WorkspaceMembership
        const log = yield* AuditEventLog
        const feed = yield* NotificationFeed
        const [members, events, unread] = yield* Effect.all(
          [membership.listMembers, log.listGlobal, feed.unreadCount],
          { concurrency: 'unbounded' }
        )
        return { members, events, unread }
      })
    ),
  component: AdminPage
})

function AdminPage() {
  const { members, events, unread } = Route.useLoaderData()

  const memberColumns = useMemo<ColumnDef<Member>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Name',
        enableSorting: true,
        meta: { sticky: true }
      },
      { accessorKey: 'email', header: 'Email', enableSorting: true },
      { accessorKey: 'role', header: 'Workspace role', enableSorting: true },
      {
        accessorKey: 'systemRole',
        header: 'System status',
        cell: ({ row }) => <Badge variant="secondary">{row.original.systemRole}</Badge>
      }
    ],
    []
  )

  const auditColumns = useMemo<ColumnDef<AuditEvent>[]>(
    () => [
      { accessorKey: 'eventType', header: 'Event', enableSorting: true },
      { accessorKey: 'targetType', header: 'Target', enableSorting: true },
      { accessorKey: 'actor', header: 'Actor', enableSorting: true },
      { accessorKey: 'createdAt', header: 'Created', enableSorting: true }
    ],
    []
  )

  return (
    <WorkspaceShell
      title="System admin"
      description="Basic Better Auth admin dashboard without impersonation UI."
      unreadCount={unread}
    >
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Users</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={memberColumns}
              data={members}
              filterColumnId="name"
              filterPlaceholder="Filter users…"
              pageSize={5}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Audit events</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={auditColumns}
              data={events}
              filterColumnId="eventType"
              filterPlaceholder="Filter events…"
              pageSize={5}
            />
          </CardContent>
        </Card>
      </div>
    </WorkspaceShell>
  )
}
