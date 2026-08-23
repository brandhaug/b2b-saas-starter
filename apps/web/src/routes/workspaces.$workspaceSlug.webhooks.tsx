import { createFileRoute } from '@tanstack/react-router'
import { RoutePending } from '@/components/route-pending'
import { WebhooksPanel } from '@/components/webhooks-panel'
import { WorkspaceShell } from '@/components/workspace-shell'
import { viewerCan } from '@/lib/permissions'
import {
  loadWorkspaceWebhooks,
  type WorkspaceWebhooksPayload
} from '@/lib/server/webhooks'

// The auth gate lives on the /workspaces layout route (workspaces.tsx);
// `context.session` arrives from there. The page's own read permission
// (`webhook:list`) is a hard gate inside the loader.
export const Route = createFileRoute('/workspaces/$workspaceSlug/webhooks')({
  loader: ({ params, context }) =>
    loadWorkspaceWebhooks({
      workspaceSlug: params.workspaceSlug,
      userId: context.session.user.id
    }),
  pendingComponent: RoutePending,
  component: WorkspaceWebhooksRoute
})

/**
 * The route's thin wrapper: reads the params and loader data the router
 * resolved, and hands them to the page. Keeping the two apart is what lets the
 * page be rendered from a test with plain props — no route tree, no loader.
 */
function WorkspaceWebhooksRoute() {
  const { workspaceSlug } = Route.useParams()
  const data = Route.useLoaderData()
  return <WorkspaceWebhooksPage workspaceSlug={workspaceSlug} data={data} />
}

export function WorkspaceWebhooksPage({
  workspaceSlug,
  data
}: {
  readonly workspaceSlug: string
  readonly data: WorkspaceWebhooksPayload
}) {
  const { viewer, unreadCount, endpoints } = data

  return (
    <WorkspaceShell
      workspaceSlug={workspaceSlug}
      title="Webhooks"
      description="Outbound endpoints that receive workspace events."
      unreadCount={unreadCount}
      canReadAuditLog={viewerCan(viewer, { auditLog: ['read'] })}
      canReadApiTokens={viewerCan(viewer, { apiToken: ['list'] })}
      canReadWebhooks={viewerCan(viewer, { webhook: ['list'] })}
    >
      <div className="grid gap-6">
        <WebhooksPanel
          workspaceSlug={workspaceSlug}
          endpoints={endpoints}
          viewer={viewer}
        />
      </div>
    </WorkspaceShell>
  )
}
