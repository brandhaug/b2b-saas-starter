import { useMemo } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { Effect } from 'effect'
import { DataTable } from '@/components/data-table'
import { WorkspaceShell } from '@/components/workspace-shell'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RoutePending } from '@/components/route-pending'
import { runCapabilities } from '@/lib/capabilities'
import { listSystemUsersServerFn, type SystemUser } from '@/lib/server/admin'
import { requireAdmin } from '@/lib/server/auth'
import { AuditEventLog, type AuditEvent } from '@b2b-saas-starter/capabilities'

export const Route = createFileRoute('/admin')({
  // requireAdmin gates on the Better Auth admin role (non-admins get a 404).
  // /admin keeps its own gate instead of joining the /workspaces layout —
  // requireSession is not enough here.
  beforeLoad: async ({ location }) => {
    const session = await requireAdmin(location.href)
    return { session }
  },
  // System-level reads only — no workspace is borrowed: users come from the
  // Better Auth admin plugin, audit events from the global log via the
  // non-workspace capabilities runner.
  loader: async () => {
    const [users, events] = await Promise.all([
      listSystemUsersServerFn(),
      runCapabilities(
        Effect.gen(function* () {
          const log = yield* AuditEventLog
          return yield* log.listGlobal
        })
      )
    ])
    return { users, events }
  },
  pendingComponent: RoutePending,
  component: AdminPage
})

function AdminPage() {
  const { users, events } = Route.useLoaderData()

  const userColumns = useMemo<ColumnDef<SystemUser>[]>(
    () => [
      {
        accessorKey: 'name',
        header: 'Name',
        enableSorting: true,
        meta: { sticky: true }
      },
      { accessorKey: 'email', header: 'Email', enableSorting: true },
      {
        accessorKey: 'role',
        header: 'System role',
        enableSorting: true,
        cell: ({ row }) => <Badge variant="secondary">{row.original.role}</Badge>
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
      workspaceSlug={null}
      title="System admin"
      description="Basic Better Auth admin dashboard without impersonation UI."
    >
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Users</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={userColumns}
              data={users}
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
