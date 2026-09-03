import { createFileRoute } from '@tanstack/react-router'
import { lazy, Suspense } from 'react'
import {
  LiveNotifications,
  type ListNotifications,
  type MarkNotificationsRead
} from '@/components/live-notifications'
import { AttentionFeed } from '@/components/attention-feed'
import { attentionItems } from '@/lib/attention'
import { PageHeader } from '@/components/page/page-header'
import { pageTitle } from '@/components/page/page-title'
import { Panel } from '@/components/page/panel'
import { RoutePending } from '@/components/route-pending'
import { WorkspaceShell } from '@/components/workspace-shell'
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
  // soft segments the attention feed reads, each dropped (null) for an actor
  // without its permission.
  loader: ({ params, context }) =>
    loadWorkspaceDashboard({
      workspaceSlug: params.workspaceSlug,
      userId: context.session.user.id
    }),
  pendingComponent: RoutePending,
  component: WorkspaceDashboardRoute,
  head: ({ params }) => ({
    meta: [{ title: pageTitle('Overview', params.workspaceSlug) }]
  })
})

/**
 * The route's thin wrapper, matching the settings route: the page takes its
 * params and payload as props so a test renders it without a route tree.
 */
function WorkspaceDashboardRoute() {
  const systemRole = Route.useRouteContext().session.user.role
  return <WorkspaceDashboardPage data={Route.useLoaderData()} systemRole={systemRole} />
}

export function WorkspaceDashboardPage({
  data,
  systemRole,
  ports
}: {
  readonly data: WorkspaceDashboardPayload
  /** The signed-in user's Better Auth system role, for the shell's admin link. */
  readonly systemRole?: string | null
  /** The server calls this page's children make, forwarded for tests. */
  readonly ports?: {
    readonly listNotifications?: ListNotifications
    readonly markNotificationsRead?: MarkNotificationsRead
  }
}) {
  const { workspace, notifications, webhooks, unreadCount, viewer } = data

  return (
    <WorkspaceShell
      workspaceSlug={workspace.slug}
      systemRole={systemRole}
      unreadCount={unreadCount}
      viewer={viewer}
    >
      <PageHeader
        title={workspace.name}
        description="What needs your attention, then what changed."
      />
      <AttentionFeed
        workspaceSlug={workspace.slug}
        items={attentionItems({
          invitations: data.invitations,
          apiTokens: data.apiTokens,
          webhooks,
          auditEvents: data.auditEvents
        })}
      />
      <LiveNotifications
        workspaceSlug={workspace.slug}
        fallback={notifications}
        {...(ports?.listNotifications === undefined
          ? {}
          : { listNotifications: ports.listNotifications })}
        {...(ports?.markNotificationsRead === undefined
          ? {}
          : { markRead: ports.markNotificationsRead })}
      />
      {/* `null` means the actor holds no `webhook:list`, so the loader never
          read the endpoints — there is nothing to chart and nothing to hide. */}
      {webhooks === null ? null : (
        <Panel title="Webhook delivery">
          <Suspense fallback={null}>
            <WebhookSuccessChart webhooks={webhooks} />
          </Suspense>
        </Panel>
      )}
    </WorkspaceShell>
  )
}
