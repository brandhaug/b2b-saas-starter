import { roleLabel } from '@/lib/value-labels'
import { workspaceViewSearch } from '@/lib/workspace-view'
import {
  FilterableDataTable,
  type DataTableField
} from '@/components/filterable-data-table'
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
import {
  type SystemUser,
  transitionAdminWorkspaceServerFn,
  type AdminWorkspace
} from '@/lib/server/admin'
import { WorkspaceSuspensionPanel } from '@/components/workspace-suspension-panel'
import { requireAdmin } from '@/lib/server/admin-route-auth'
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

function userFields(): ReadonlyArray<DataTableField<SystemUser>> {
  return [
    { id: 'name', label: m.admin_name(), kind: 'text', value: (row) => row.name },
    { id: 'email', label: m.admin_email(), kind: 'text', value: (row) => row.email },
    {
      id: 'role',
      label: m.admin_system_role(),
      kind: 'select',
      options: [
        { value: 'admin', label: roleLabel('admin') },
        { value: 'user', label: roleLabel('user') }
      ],
      value: (row) => row.role
    },
    {
      id: 'banned',
      label: m.status(),
      kind: 'select',
      options: [
        { value: 'true', label: m.user_banned() },
        { value: 'false', label: m.user_active() }
      ],
      value: (row) => row.banned
    }
  ]
}

function auditFields(): ReadonlyArray<DataTableField<AuditEvent>> {
  return [
    {
      id: 'eventType',
      label: m.event_label(),
      kind: 'text',
      value: (row) => row.eventType
    },
    {
      id: 'targetType',
      label: m.target_label(),
      kind: 'text',
      value: (row) => row.targetType
    },
    { id: 'actor', label: m.actor_label(), kind: 'text', value: (row) => row.actor },
    {
      id: 'createdAt',
      label: m.admin_created(),
      kind: 'date',
      value: (row) => row.createdAt
    }
  ]
}

function suspensionView(workspace: AdminWorkspace) {
  const base = { status: workspace.suspension.status }
  const withExplanation =
    workspace.suspension.customerExplanation === null
      ? base
      : { ...base, customerExplanation: workspace.suspension.customerExplanation }
  if (workspace.suspension.changedAt === null) {
    return withExplanation
  }
  return { ...withExplanation, suspendedAt: workspace.suspension.changedAt }
}

export const Route = createFileRoute('/admin')({
  validateSearch: workspaceViewSearch,
  loaderDeps: ({ search }) => ({
    view: search.failureView,
    cursor: search.failureCursor
  }),
  // requireAdmin gates on the Better Auth admin role (non-admins get a 404).
  // /admin keeps its own gate instead of joining the /workspaces layout —
  // requireSession is not enough here.
  beforeLoad: async ({ location }) => {
    const session = await requireAdmin(location.href)
    return { session }
  },
  // Parallel system-level reads; no workspace context is borrowed.
  loader: ({ deps }) => loadAdminPage(deps),
  pendingComponent: RoutePending,
  component: AdminPage,
  head: () => ({ meta: [{ title: pageTitle(m.public_meta_admin()) }] })
})

function AdminPage() {
  const { users, events, failedDeliveries, emailDeliveries, workspaces } =
    Route.useLoaderData()
  const { session } = Route.useRouteContext()
  const search = Route.useSearch()

  return (
    <WorkspaceShell viewer={null} systemRole={session.user.role} workspaceSlug={null}>
      <PageHeader
        title={m.nav_system_admin()}
        description={m.page_admin_description()}
      />
      <Panel title={m.panel_users()}>
        <FilterableDataTable
          viewKey="admin-users"
          fields={userFields()}
          columns={userColumns()}
          data={users}
          pageSize={5}
          tableLabel={m.admin_system_users()}
          emptyMessage={m.common_no_system_users()}
        >
          <DataTableFilter placeholder={m.admin_filter_users()} />
          <DataTableContent />
          <DataTablePagination />
        </FilterableDataTable>
        <AdminUserActions users={users} />
      </Panel>

      <Panel
        title={m.admin_workspace_lifecycle()}
        description={m.admin_workspace_lifecycle_description()}
      >
        <div className="grid gap-3">
          {workspaces.map((workspace: AdminWorkspace) => (
            <WorkspaceSuspensionPanel
              key={workspace.id}
              workspaceId={workspace.id}
              workspaceName={workspace.name}
              suspension={suspensionView(workspace)}
              suspend={({ data }) =>
                transitionAdminWorkspaceServerFn({
                  data: {
                    workspaceId: data.workspaceId,
                    action: 'suspend',
                    internalReason: data.internalReason,
                    customerExplanation: data.customerExplanation
                  }
                })
              }
              reactivate={({ data }) =>
                transitionAdminWorkspaceServerFn({
                  data: {
                    workspaceId: data.workspaceId,
                    action: 'unsuspend',
                    internalReason: data.internalReason
                  }
                })
              }
            />
          ))}
        </div>
      </Panel>

      <AdminFailedDeliveries
        initialPage={failedDeliveries}
        serializedView={search.failureView}
      />
      <EmailDeliveryPanel records={emailDeliveries} />

      <Panel title={m.panel_audit_events()}>
        <FilterableDataTable
          viewKey="admin-audit"
          fields={auditFields()}
          columns={auditColumns()}
          data={events}
          pageSize={5}
          tableLabel={m.admin_audit_events()}
          emptyMessage={m.common_no_audit_events()}
        >
          <DataTableFilter placeholder={m.admin_filter_events()} />
          <DataTableContent />
          <DataTablePagination />
        </FilterableDataTable>
      </Panel>
    </WorkspaceShell>
  )
}
