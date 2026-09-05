import { createFileRoute } from '@tanstack/react-router'
import { pageTitle } from '@/components/page/page-title'
import { RoutePending } from '@/components/route-pending'
import { WorkspaceWebhooksPage } from '@/components/workspace-webhooks-page'
import { loadWorkspaceWebhooks } from '@/lib/server/webhooks'

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
  head: ({ params }) => ({
    meta: [{ title: pageTitle('Webhooks', params.workspaceSlug) }]
  })
})

/**
 * The route's thin wrapper: reads the params and loader data the router
 * resolved, and hands them to the page. Keeping the two apart is what lets the
 * page be rendered from a test with plain props — no route tree, no loader.
 * The page itself lives in `components/workspace-webhooks-page.tsx` — a page
 * exported from the route file would pin its import graph into the route tree
 * every page preloads.
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
