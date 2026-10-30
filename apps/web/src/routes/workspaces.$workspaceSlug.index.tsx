import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { pageQueryOptions } from '@/lib/page-query'
import { RoutePending } from '@/components/route-pending'
import { WorkspaceDashboardPage } from '@/components/workspace-dashboard-page'
import { pageTitle } from '@/components/page/page-title'
import { loadWorkspaceDashboardServerFn } from '@/lib/server/workspace-dashboard'
import { m } from '@b2b-saas-starter/i18n/messages'

// The auth gate lives on the /workspaces layout route (workspaces.tsx);
// `context.session` arrives from there.
function dashboardQuery(actorId: string, workspaceSlug: string) {
  return pageQueryOptions(['workspace-dashboard', actorId, workspaceSlug], () =>
    loadWorkspaceDashboardServerFn({ data: { workspaceSlug } })
  )
}

export const Route = createFileRoute('/workspaces/$workspaceSlug/')({
  // The `workspaceDashboard` projection — shared with the REST `overview`
  // endpoint so app and Capability Interface views cannot drift — plus the
  // soft segments the attention feed reads, each dropped (null) for an actor
  // without its permission, plus the onboarding checklist.
  loader: ({ params, context }) =>
    context.queryClient.query({
      ...dashboardQuery(context.session.user.id, params.workspaceSlug),
      staleTime: 0
    }),
  pendingComponent: RoutePending,
  component: WorkspaceDashboardRoute,
  head: ({ params }) => ({
    meta: [{ title: pageTitle(m.public_meta_overview(), params.workspaceSlug) }]
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
  const { data } = useSuspenseQuery(
    dashboardQuery(
      Route.useRouteContext().session.user.id,
      Route.useParams().workspaceSlug
    )
  )
  const systemRole = Route.useRouteContext().session.user.role
  return <WorkspaceDashboardPage data={data} systemRole={systemRole} />
}
