import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { pageQueryOptions } from '@/lib/page-query'
import { pageTitle } from '@/components/page/page-title'
import { RoutePending } from '@/components/route-pending'
import { WorkspaceMembersPage } from '@/components/workspace-members-page'
import { loadWorkspaceMembersServerFn } from '@/lib/server/workspace-members'
import { m } from '@b2b-saas-starter/i18n/messages'

// The auth gate lives on the /workspaces layout route (workspaces.tsx);
// `context.session` arrives from there.
function membersQuery(actorId: string, workspaceSlug: string) {
  return pageQueryOptions(['workspace-members', actorId, workspaceSlug], () =>
    loadWorkspaceMembersServerFn({ data: { workspaceSlug } })
  )
}

export const Route = createFileRoute('/workspaces/$workspaceSlug/members')({
  loader: ({ params, context }) =>
    context.queryClient.query({
      ...membersQuery(context.session.user.id, params.workspaceSlug),
      staleTime: 0
    }),
  pendingComponent: RoutePending,
  component: WorkspaceMembersRoute,
  head: ({ params }) => ({
    meta: [{ title: pageTitle(m.public_meta_members(), params.workspaceSlug) }]
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
  const session = Route.useRouteContext().session
  const { data } = useSuspenseQuery(membersQuery(session.user.id, workspaceSlug))
  return (
    <WorkspaceMembersPage
      workspaceSlug={workspaceSlug}
      data={data}
      systemRole={session.user.role}
      actorUserId={session.user.id}
    />
  )
}
