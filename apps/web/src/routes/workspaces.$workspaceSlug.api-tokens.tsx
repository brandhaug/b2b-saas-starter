import { createFileRoute } from '@tanstack/react-router'
import { pageTitle } from '@/components/page/page-title'
import { RoutePending } from '@/components/route-pending'
import { WorkspaceApiTokensPage } from '@/components/workspace-api-tokens-page'
import { loadWorkspaceApiTokens } from '@/lib/server/api-tokens'

// The auth gate lives on the /workspaces layout route (workspaces.tsx);
// `context.session` arrives from there. The page's own read permission
// (`apiToken:list`) is a hard gate inside the loader.
export const Route = createFileRoute('/workspaces/$workspaceSlug/api-tokens')({
  loader: ({ params, context }) =>
    loadWorkspaceApiTokens({
      workspaceSlug: params.workspaceSlug,
      userId: context.session.user.id
    }),
  pendingComponent: RoutePending,
  component: WorkspaceApiTokensRoute,
  head: ({ params }) => ({
    meta: [{ title: pageTitle('API tokens', params.workspaceSlug) }]
  })
})

/**
 * The route's thin wrapper: reads the params and loader data the router
 * resolved, and hands them to the page. Keeping the two apart is what lets the
 * page be rendered from a test with plain props — no route tree, no loader.
 * The page itself lives in `components/workspace-api-tokens-page.tsx` — a
 * page exported from the route file would pin its import graph into the route
 * tree every page preloads.
 */
function WorkspaceApiTokensRoute() {
  const { workspaceSlug } = Route.useParams()
  const data = Route.useLoaderData()
  const systemRole = Route.useRouteContext().session.user.role
  return (
    <WorkspaceApiTokensPage
      workspaceSlug={workspaceSlug}
      data={data}
      systemRole={systemRole}
    />
  )
}
