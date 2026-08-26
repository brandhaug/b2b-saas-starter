import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import {
  LiveNotifications,
  type ListNotifications
} from '@/components/live-notifications'
import { RoutePending } from '@/components/route-pending'
import { WorkspaceShell } from '@/components/workspace-shell'
import { viewerCan } from '@/lib/permissions'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  loadWorkspaceDashboard,
  type WorkspaceDashboardPayload
} from '@/lib/server/workspace-dashboard'

// The auth gate lives on the /workspaces layout route (workspaces.tsx);
// `context.session` arrives from there.
// Lazy: recharts (and its d3 dependencies) is the heaviest module on this
// route, and the chart is below-fold secondary content — it must not sit in
// the dashboard's first chunk. `defaultPreload: 'intent'` warms the chunk on
// navigation intent.
async function loadWebhookSuccessChart() {
  const chart = await import('@/components/charts/webhook-success-chart')
  return { default: chart.WebhookSuccessChart }
}

const WebhookSuccessChart = lazy(loadWebhookSuccessChart)

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
  const { workspace, notifications, webhooks, unreadCount, viewer } = data

  return (
    <WorkspaceShell
      workspaceSlug={workspace.slug}
      title={workspace.name}
      description="Notifications, API tokens, webhooks, and reports."
      unreadCount={unreadCount}
      canReadAuditLog={viewerCan(viewer, { auditLog: ['read'] })}
    >
      <div className="grid gap-6">
        <div className="grid gap-6">
          <LiveNotifications
            workspaceSlug={workspace.slug}
            fallback={notifications}
            {...(ports?.listNotifications === undefined
              ? {}
              : { listNotifications: ports.listNotifications })}
          />
          {/* `null` means the actor holds no `webhook:list`, so the loader never
              read the endpoints — there is nothing to chart and nothing to hide. */}
          {webhooks === null ? null : (
            <Card>
              <CardHeader>
                <CardTitle as="h2">Webhook delivery</CardTitle>
              </CardHeader>
              <CardContent>
                <Suspense fallback={null}>
                  <WebhookSuccessChart webhooks={webhooks} />
                </Suspense>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </WorkspaceShell>
  )
}
