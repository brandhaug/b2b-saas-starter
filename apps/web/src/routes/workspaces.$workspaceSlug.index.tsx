import { createFileRoute } from '@tanstack/react-router'
import { RoutePending } from '@/components/route-pending'
import { WorkspaceDashboardPage } from '@/components/workspace-dashboard-page'
import { pageTitle } from '@/components/page/page-title'
import { loadWorkspaceDashboard } from '@/lib/server/workspace-dashboard'

// The auth gate lives on the /workspaces layout route (workspaces.tsx);
// `context.session` arrives from there.
export const Route = createFileRoute('/workspaces/$workspaceSlug/')({
  // The `workspaceDashboard` projection — shared with the REST `overview`
  // endpoint so app and Capability Interface views cannot drift — plus the
  // soft segments the attention feed reads, each dropped (null) for an actor
  // without its permission, plus the onboarding checklist.
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
 * params and payload as props so a test renders it without a route tree. The
 * page itself lives in `components/workspace-dashboard-page.tsx` — a page
 * exported from the route file would pin its import graph into the route
 * tree every page preloads.
 */
function WorkspaceDashboardRoute() {
  const systemRole = Route.useRouteContext().session.user.role
  return <WorkspaceDashboardPage data={Route.useLoaderData()} systemRole={systemRole} />
}
