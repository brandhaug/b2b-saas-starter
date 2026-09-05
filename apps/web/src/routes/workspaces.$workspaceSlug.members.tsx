import { createFileRoute } from '@tanstack/react-router'
import { pageTitle } from '@/components/page/page-title'
import { RoutePending } from '@/components/route-pending'
import { WorkspaceMembersPage } from '@/components/workspace-members-page'
import { loadWorkspaceMembers } from '@/lib/server/workspace-members'

// The auth gate lives on the /workspaces layout route (workspaces.tsx);
// `context.session` arrives from there.
export const Route = createFileRoute('/workspaces/$workspaceSlug/members')({
  loader: ({ params, context }) =>
    loadWorkspaceMembers({
      workspaceSlug: params.workspaceSlug,
      userId: context.session.user.id
    }),
  pendingComponent: RoutePending,
  component: WorkspaceMembersRoute,
  head: ({ params }) => ({
    meta: [{ title: pageTitle('Members', params.workspaceSlug) }]
  })
})

/**
 * The route's thin wrapper: reads the params and loader data the router
 * resolved, and hands them to the page. Keeping the two apart is what lets the
 * page be rendered from a test with plain props — no route tree, no loader.
 * The page itself lives in `components/workspace-members-page.tsx` — a page
 * exported from the route file would pin its import graph into the route tree
 * every page preloads.
 */
function WorkspaceMembersRoute() {
  const { workspaceSlug } = Route.useParams()
  const data = Route.useLoaderData()
  const session = Route.useRouteContext().session
  return (
    <WorkspaceMembersPage
      workspaceSlug={workspaceSlug}
      data={data}
      systemRole={session.user.role}
      actorUserId={session.user.id}
    />
  )
}
