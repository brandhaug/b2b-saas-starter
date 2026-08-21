import { createFileRoute } from '@tanstack/react-router'
import { AdoptionTrendChart } from '@/components/charts/adoption-trend-chart'
import { CatalogRefreshChart } from '@/components/charts/catalog-refresh-chart'
import {
  LiveNotifications,
  type ListNotifications
} from '@/components/live-notifications'
import { RoutePending } from '@/components/route-pending'
import { ModuleStatusChart } from '@/components/charts/module-status-chart'
import { WebhookSuccessChart } from '@/components/charts/webhook-success-chart'
import { DataTable, type DataTableColumnDef } from '@/components/data-table'
import { WorkspaceShell } from '@/components/workspace-shell'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  loadWorkspaceDashboard,
  type WorkspaceDashboardPayload
} from '@/lib/server/workspace-dashboard'

type ModuleRow = {
  readonly id: string
  readonly name: string
  readonly summary: string
  readonly category: string
  readonly status: string
  readonly missingConfig: string
}

// Column definitions are static — module scope keeps the cell renderers out of
// the render body (they would remount every render) and drops a useMemo.
const moduleColumns: DataTableColumnDef<ModuleRow>[] = [
  {
    accessorKey: 'name',
    header: 'Module',
    enableSorting: true,
    meta: { sticky: true },
    cell: ({ row }) => (
      <div>
        <div className="font-medium">{row.original.name}</div>
        <div className="max-w-md text-xs text-muted-foreground">
          {row.original.summary}
        </div>
      </div>
    )
  },
  { accessorKey: 'category', header: 'Category', enableSorting: true },
  {
    accessorKey: 'status',
    header: 'Status',
    enableSorting: true,
    cell: ({ row }) => (
      <Badge variant={row.original.status === 'ready' ? 'default' : 'secondary'}>
        {row.original.status}
      </Badge>
    )
  },
  {
    accessorKey: 'missingConfig',
    header: 'Missing config',
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">
        {row.original.missingConfig}
      </span>
    )
  }
]

// The auth gate lives on the /workspaces layout route (workspaces.tsx);
// `context.session` arrives from there.
export const Route = createFileRoute('/workspaces/$workspaceSlug/')({
  // The `workspaceDashboard` projection — shared with the REST `overview`
  // endpoint so app and Capability Interface views cannot drift — plus the
  // webhook segment, which the loader drops for an actor without
  // `webhook:list`.
  loader: ({ params, context }) =>
    loadWorkspaceDashboard({
      workspaceSlug: params.workspaceSlug,
      userId: context.session.user.id
    }),
  pendingComponent: RoutePending,
  component: WorkspaceDashboardRoute
})

/**
 * The route's thin wrapper, matching the settings route: the page takes its
 * params and payload as props so a test renders it without a route tree.
 */
function WorkspaceDashboardRoute() {
  return <WorkspaceDashboardPage data={Route.useLoaderData()} />
}

export function WorkspaceDashboardPage({
  data,
  ports
}: {
  readonly data: WorkspaceDashboardPayload
  /** The one server call this page's children make, forwarded for tests. */
  readonly ports?: { readonly listNotifications?: ListNotifications }
}) {
  const {
    workspace,
    modules,
    notifications,
    webhooks,
    refreshRuns,
    readinessTrend,
    readinessScore,
    readyCount,
    unreadCount,
    moduleStatusCounts
  } = data

  const moduleRows: readonly ModuleRow[] = modules.map((module) => ({
    id: module.id,
    name: module.name,
    summary: module.summary,
    category: module.category,
    status: module.state.status,
    missingConfig: module.state.missingConfig.join(', ') || 'None'
  }))

  return (
    <WorkspaceShell
      workspaceSlug={workspace.slug}
      title={workspace.name}
      description="Adoption readiness, module state, integrations, API tokens, webhooks, and reports."
      unreadCount={unreadCount}
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4">
            <div className="grid gap-1">
              <CardTitle>Starter modules</CardTitle>
              <p className="text-xs text-muted-foreground">
                Adoption readiness across the workspace.
              </p>
            </div>
            <Badge variant="secondary">
              {readinessScore}% · {readyCount}/{modules.length}
            </Badge>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={moduleColumns}
              data={moduleRows}
              filterColumnId="name"
              filterPlaceholder="Filter modules…"
              pageSize={8}
            />
          </CardContent>
        </Card>

        <div className="grid gap-6">
          <LiveNotifications
            workspaceSlug={workspace.slug}
            fallback={notifications}
            {...(ports?.listNotifications === undefined
              ? {}
              : { listNotifications: ports.listNotifications })}
          />
          <Card>
            <CardHeader>
              <CardTitle>Readiness trend</CardTitle>
            </CardHeader>
            <CardContent>
              <AdoptionTrendChart data={readinessTrend} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Module status</CardTitle>
            </CardHeader>
            <CardContent>
              <ModuleStatusChart data={moduleStatusCounts} />
            </CardContent>
          </Card>
          {/* `null` means the actor holds no `webhook:list`, so the loader never
              read the endpoints — there is nothing to chart and nothing to hide. */}
          {webhooks === null ? null : (
            <Card>
              <CardHeader>
                <CardTitle>Webhook delivery</CardTitle>
              </CardHeader>
              <CardContent>
                <WebhookSuccessChart webhooks={webhooks} />
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Catalog refresh history</CardTitle>
            </CardHeader>
            <CardContent>
              <CatalogRefreshChart runs={refreshRuns} />
            </CardContent>
          </Card>
        </div>
      </div>
    </WorkspaceShell>
  )
}
