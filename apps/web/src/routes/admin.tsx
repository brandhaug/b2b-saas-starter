import {
  type AuditEvent,
  AuditEventLog
} from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import { createFileRoute } from '@tanstack/react-router'
import { Effect } from 'effect'

import { AdminUserActions } from '@/components/admin-user-actions'
import { BanUserAction } from '@/components/ban-user-action'
import { DataTable, type DataTableColumnDef } from '@/components/data-table'
import { PageHeader } from '@/components/page/page-header'
import { Panel } from '@/components/page/panel'
import { WorkspaceShell } from '@/components/workspace-shell'
import { Badge } from '@/components/ui/badge'
import { RoutePending } from '@/components/route-pending'
import { runCapabilities } from '@/lib/capabilities'
import { formatDateTime } from '@/lib/format-date'
import { listSystemUsersServerFn, type SystemUser } from '@/lib/server/admin'
import { requireAdmin } from '@/lib/server/auth'

// Column definitions are static — module scope keeps the cell renderers out of
// the render body (they would remount every render) and drops a useMemo.
function renderStatus(banned: boolean) {
  if (banned) {
    return <Badge variant="destructive">banned</Badge>
  }
  return <Badge variant="ok">active</Badge>
}

const userColumns: Array<DataTableColumnDef<SystemUser>> = [
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
  },
  {
    accessorKey: 'banned',
    header: 'Status',
    cell: ({ row }) => renderStatus(row.original.banned)
  },
  {
    id: 'actions',
    // Screen readers announce an empty column header as nothing; name it.
    header: () => <span className="sr-only">Actions</span>,
    enableSorting: false,
    cell: ({ row }) => <BanUserAction user={row.original} />
  }
]

const auditColumns: Array<DataTableColumnDef<AuditEvent>> = [
  { accessorKey: 'eventType', header: 'Event', enableSorting: true },
  { accessorKey: 'targetType', header: 'Target', enableSorting: true },
  { accessorKey: 'actor', header: 'Actor', enableSorting: true },
  {
    accessorKey: 'createdAt',
    header: 'Created',
    enableSorting: true,
    // The shared table timestamp — identical to the audit trail's rendering.
    cell: ({ row }) => (
      <span className="font-mono tabular-nums">
        {formatDateTime(row.original.createdAt)} UTC
      </span>
    )
  }
]

export const Route = createFileRoute('/admin')({
  // requireAdmin gates on the Better Auth admin role (non-admins get a 404).
  // /admin keeps its own gate instead of joining the /workspaces layout —
  // requireSession is not enough here.
  beforeLoad: async ({ location }) => {
    const session = await requireAdmin(location.href)
    return { session }
  },
  // System-level reads only — no workspace is borrowed: users come from the
  // PlatformUserAdmin capability, audit events from the global log via the
  // non-workspace capabilities runner. Both reads are started before either
  // is awaited, so they still overlap.
  loader: async () => {
    const usersRead = listSystemUsersServerFn()
    const eventsRead = runCapabilities(
      Effect.gen(function* () {
        const log = yield* AuditEventLog
        return yield* log.listGlobal
      })
    )
    return { users: await usersRead, events: await eventsRead }
  },
  pendingComponent: RoutePending,
  component: AdminPage,
  head: () => ({ meta: [{ title: 'System admin | B2B SaaS Starter' }] })
})

function AdminPage() {
  const { users, events } = Route.useLoaderData()
  const { session } = Route.useRouteContext()

  return (
    <WorkspaceShell viewer={null} systemRole={session.user.role} workspaceSlug={null}>
      <PageHeader
        title="System admin"
        description="Better Auth admin dashboard without impersonation UI."
      />
      <Panel title="Users">
        <DataTable
          columns={userColumns}
          data={users}
          filterColumnId="name"
          filterPlaceholder="Filter users…"
          pageSize={5}
          tableLabel="System users"
          emptyMessage="No system users."
        />
        <AdminUserActions users={users} />
      </Panel>

      <Panel title="Audit events">
        <DataTable
          columns={auditColumns}
          data={events}
          filterColumnId="eventType"
          filterPlaceholder="Filter events…"
          pageSize={5}
          tableLabel="Audit events"
          emptyMessage="No audit events."
        />
      </Panel>
    </WorkspaceShell>
  )
}
