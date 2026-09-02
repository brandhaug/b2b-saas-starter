import { createFileRoute } from '@tanstack/react-router'
import { RoutePending } from '@/components/route-pending'
import { WebhooksPanel } from '@/components/webhooks-panel'
import { WorkspaceShell } from '@/components/workspace-shell'
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
  component: WorkspaceWebhooksRoute,
  // Derives the document title from the page the shell names.
  head: ({ params }) => ({
    meta: [{ title: `Webhooks · ${params.workspaceSlug} | B2B SaaS Starter` }]
  })
})

/**
 * The route's thin wrapper: reads the params and loader data the router
 * resolved, and hands them to the page. Keeping the two apart is what lets the
 * page be rendered from a test with plain props — no route tree, no loader.
 */
function WorkspaceWebhooksRoute() {
  const { workspaceSlug } = Route.useParams()
  const data = Route.useLoaderData()
  const systemRole = Route.useRouteContext().session.user.role
  return (
    <WorkspaceWebhooksPage
      workspaceSlug={workspaceSlug}
      data={data}
      systemRole={systemRole}
    />
  )
}

export function WorkspaceWebhooksPage({
  workspaceSlug,
  data,
  systemRole
}: {
  readonly workspaceSlug: string
  readonly data: WorkspaceWebhooksPayload
  /** The signed-in user's Better Auth system role, for the shell's admin link. */
  readonly systemRole?: string | null
}) {
  const { viewer, unreadCount, endpoints } = data

  return (
    <WorkspaceShell
      workspaceSlug={workspaceSlug}
      systemRole={systemRole}
      title="Webhooks"
      description="Outbound endpoints that receive workspace events."
      unreadCount={unreadCount}
      viewer={viewer}
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
