import { createFileRoute } from '@tanstack/react-router'
import { pageTitle } from '@/components/page/page-title'
import { RoutePending } from '@/components/route-pending'
import { WorkspaceSettingsPage } from '@/components/workspace-settings-page'
import { loadWorkspaceSettings } from '@/lib/server/workspace-settings'

// The auth gate lives on the /workspaces layout route (workspaces.tsx);
// `context.session` arrives from there.
export const Route = createFileRoute('/workspaces/$workspaceSlug/settings')({
  // The loader assembles the payload per actor: a segment the actor may not
  // read is never read, so it arrives as `null` rather than as data the
  // component has to remember to hide.
  loader: ({ params, context }) =>
    loadWorkspaceSettings({
      workspaceSlug: params.workspaceSlug,
      userId: context.session.user.id
    }),
  pendingComponent: RoutePending,
  component: WorkspaceSettingsRoute,
  head: ({ params }) => ({
    meta: [{ title: pageTitle('Settings', params.workspaceSlug) }]
  })
})

/**
 * The route's thin wrapper: reads the params and loader data the router
 * resolved, and hands them to the page. Keeping the two apart is what lets the
 * page be rendered from a test with plain props — no route tree, no loader,
 * and no mocked router. The page itself lives in
 * `components/workspace-settings-page.tsx` — a page exported from the route
 * file would pin its import graph into the route tree every page preloads.
 */
function WorkspaceSettingsRoute() {
  const { workspaceSlug } = Route.useParams()
  const data = Route.useLoaderData()
  const systemRole = Route.useRouteContext().session.user.role
  return (
    <WorkspaceSettingsPage
      workspaceSlug={workspaceSlug}
      data={data}
      systemRole={systemRole}
    />
  )
}
