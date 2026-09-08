import { roleLabel } from '@/lib/value-labels'
import { type AuditEvent } from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import { pageTitle } from '@/components/page/page-title'
import { createFileRoute } from '@tanstack/react-router'

import { AdminUserActions } from '@/components/admin-user-actions'
import { AdminFailedDeliveries } from '@/components/admin-failed-deliveries'
import { EmailDeliveryPanel } from '@/components/email-delivery-panel'
import { loadAdminPage } from '@/lib/server/admin-loader'
import { BanUserAction } from '@/components/ban-user-action'
import { ImpersonateUserAction } from '@/components/impersonate-user-action'
import {
  DataTable,
  DataTableContent,
  DataTableFilter,
  DataTablePagination,
  type DataTableColumnDef
} from '@/components/data-table'
import { PageHeader } from '@/components/page/page-header'
import { Panel } from '@/components/page/panel'
import { WorkspaceShell } from '@/components/workspace-shell'
import { Badge } from '@/components/ui/badge'
import { RoutePending } from '@/components/route-pending'
import { formatDateTime } from '@/lib/format-date'
import { auditActorTypeLabel } from '@/lib/audit-labels'
import { auditActorTypeVariant } from '@/lib/badge-variants'
import { type SystemUser } from '@/lib/server/admin'
import { requireAdmin } from '@/lib/server/auth'
import { m } from '@b2b-saas-starter/i18n/messages'

// Column definitions are static — module scope keeps the cell renderers out of
// the render body (they would remount every render) and drops a useMemo.
function renderStatus(banned: boolean) {
  if (banned) {
    return <Badge variant="destructive">{m.user_banned()}</Badge>
  }
  return <Badge variant="ok">{m.user_active()}</Badge>
}

function userColumns(): Array<DataTableColumnDef<SystemUser>> {
  return [
    {
      accessorKey: 'name',
      header: m.admin_name(),
      enableSorting: true,
      meta: { sticky: true }
    },
    { accessorKey: 'email', header: m.admin_email(), enableSorting: true },
    {
      accessorKey: 'role',
      header: m.admin_system_role(),
      enableSorting: true,
      cell: ({ row }) => <Badge variant="neutral">{roleLabel(row.original.role)}</Badge>
    },
    {
      accessorKey: 'banned',
      header: m.status(),
      cell: ({ row }) => renderStatus(row.original.banned)
    },
    {
      id: 'actions',
      // Screen readers announce an empty column header as nothing; name it.
      header: () => <span className="sr-only">{m.common_actions()}</span>,
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <ImpersonateUserAction user={row.original} />
          <BanUserAction user={row.original} />
        </div>
      )
    }
  ]
}

function auditColumns(): Array<DataTableColumnDef<AuditEvent>> {
  return [
    { accessorKey: 'eventType', header: m.event_label(), enableSorting: true },
    { accessorKey: 'targetType', header: m.target_label(), enableSorting: true },
    {
      accessorKey: 'actor',
      header: m.actor_label(),
      enableSorting: true,
      cell: ({ row }) => (
        <span className="flex flex-wrap items-center gap-1.5 break-words">
          {row.original.actor}{' '}
          <Badge variant={auditActorTypeVariant(row.original.actorType)}>
            {auditActorTypeLabel(row.original.actorType)}
          </Badge>
        </span>
      )
    },
    {
      accessorKey: 'createdAt',
      header: m.admin_created(),
      enableSorting: true,
      // The shared table timestamp — identical to the audit trail's rendering.
      cell: ({ row }) => (
        <span className="font-mono tabular-nums">
          {formatDateTime(row.original.createdAt)}
        </span>
      )
    }
  ]
}

export const Route = createFileRoute('/admin')({
  // requireAdmin gates on the Better Auth admin role (non-admins get a 404).
  // /admin keeps its own gate instead of joining the /workspaces layout —
  // requireSession is not enough here.
  beforeLoad: async ({ location }) => {
    const session = await requireAdmin(location.href)
    return { session }
  },
  // Parallel system-level reads; no workspace context is borrowed.
  loader: loadAdminPage,
  pendingComponent: RoutePending,
  component: AdminPage,
  head: () => ({ meta: [{ title: pageTitle(m.public_meta_admin()) }] })
})

function AdminPage() {
  const { users, events, failedDeliveries, emailDeliveries } = Route.useLoaderData()
  const { session } = Route.useRouteContext()

  return (
    <WorkspaceShell viewer={null} systemRole={session.user.role} workspaceSlug={null}>
      <PageHeader
        title={m.nav_system_admin()}
        description={m.page_admin_description()}
      />
      <Panel title={m.panel_users()}>
        <DataTable
          columns={userColumns()}
          data={users}
          pageSize={5}
          tableLabel={m.admin_system_users()}
          emptyMessage={m.common_no_system_users()}
        >
          <DataTableFilter placeholder={m.admin_filter_users()} />
          <DataTableContent />
          <DataTablePagination />
        </DataTable>
        <AdminUserActions users={users} />
      </Panel>

      <AdminFailedDeliveries initialPage={failedDeliveries} />
      <EmailDeliveryPanel records={emailDeliveries} />

      <Panel title={m.panel_audit_events()}>
        <DataTable
          columns={auditColumns()}
          data={events}
          pageSize={5}
          tableLabel={m.admin_audit_events()}
          emptyMessage={m.common_no_audit_events()}
        >
          <DataTableFilter placeholder={m.admin_filter_events()} />
          <DataTableContent />
          <DataTablePagination />
        </DataTable>
      </Panel>
    </WorkspaceShell>
  )
}
